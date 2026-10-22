(() => {
'use strict';
const $ = id => document.getElementById(id);
const state = {student:null, passages:[], sessions:[], active:null, recognition:null, startedAt:null, endedAt:null, timer:null, transcript:'', finalTranscript:'', isListening:false, wordSpans:[]};
const normalise = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’‘]/g,"'").replace(/[^a-z0-9']/g,'');
const tokens = s => String(s||'').match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)||[];
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const configured = () => window.FIREBASE_READY && window.firebase;
let db=null, root=null;
if(configured()){try{firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.database();root=db.ref();}catch(e){console.error(e);}}
function show(view){const g=$('guide');if(g)g.classList.toggle('hidden',view==='readingView');['loginView','dashboardView','readingView'].forEach(id=>$(id).classList.toggle('hidden',id!==view));}
function sayStatus(s){$('speechStatus').textContent=s;}
function dateLabel(ms){return new Date(ms).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});}
function noticeConfig(){if(!db){$('loginError').textContent='Firebase is not configured. Edit firebase-config.js with your project settings, then reload.';}}
function read(path){return root.child(path).once('value').then(s=>s.val()||{});}
function save(path,value){return root.child(path).set(value);}
function uuid(){return 'id_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,9);}
async function login(passcode){
 if(String(passcode).trim()==='123123'){
  if(!db){noticeConfig();return;}
  state.student={id:'demo-reader',name:'Demo Student',class:'Demo Class',passcode:'123123',active:true,demo:true};
  sessionStorage.setItem('rfStudent',state.student.id);sessionStorage.setItem('rfPasscode','123123');show('dashboardView');$('studentName').textContent=state.student.name;await ensureMic();await loadDashboard();return;
 }
 if(!db){noticeConfig();return;}
 const students=await read('readingFluency/students'); const found=Object.entries(students).find(([id,s])=>s && String(s.passcode||'').trim().toLowerCase()===passcode.trim().toLowerCase() && s.active!==false);
 if(!found){$('loginError').textContent='That passcode was not found. Check it with your teacher and try again.';return;}
 state.student={id:found[0],...found[1]}; sessionStorage.setItem('rfStudent',state.student.id); sessionStorage.setItem('rfPasscode',passcode.trim());
 show('dashboardView');$('studentName').textContent=state.student.name||'Reader';
 await ensureMic();
 await loadDashboard();
}
async function restore(){const id=sessionStorage.getItem('rfStudent'), code=sessionStorage.getItem('rfPasscode');if(id==='demo-reader'&&code==='123123'){state.student={id:'demo-reader',name:'Demo Student',class:'Demo Class',passcode:'123123',active:true,demo:true};show('dashboardView');$('studentName').textContent=state.student.name;await ensureMic();await loadDashboard();return;}if(!id||!code||!db)return;try{const s=await root.child('readingFluency/students/'+id).once('value');if(s.exists()&&String(s.val().passcode).toLowerCase()===code.toLowerCase()){state.student={id,...s.val()};show('dashboardView');$('studentName').textContent=state.student.name||'Reader';await ensureMic();await loadDashboard();}}catch(e){console.error(e);}}
function cleanPassage(id,v){if(!v||typeof v!=='object')return null;const text=String(v.text??'').replace(/\s+/g,' ').trim();if(!text)return null;return {...v,id,title:String(v.title||'Untitled passage').trim(),level:String(v.level||'').trim(),text};}
function isPublished(p){return !!p&&p.status!=='draft'&&p.active!==false;}
let passageRef=null,passageHandler=null;
function stopPassageFeed(){if(passageRef&&passageHandler)passageRef.off('value',passageHandler);passageRef=passageHandler=null;}
async function loadDashboard(){
 show('dashboardView');$('studentName').textContent=state.student.name||'Reader';
 if(!db){state.passages=[];renderDashboard();return;}
 // Passages come ONLY from Firebase and stay live: anything the admin adds, edits, unpublishes or deletes appears here without a reload.
 stopPassageFeed();
 passageRef=root.child('readingFluency/passages');
 const first=new Promise(resolve=>{
  passageHandler=snap=>{
   const v=snap.val()||{};
   state.passages=Object.entries(v).map(([id,p])=>cleanPassage(id,p)).filter(isPublished).sort((x,y)=>(x.title||'').localeCompare(y.title||'',undefined,{numeric:true,sensitivity:'base'}));
   if(!$('dashboardView').classList.contains('hidden'))renderDashboard();
   resolve();
  };
  passageRef.on('value',passageHandler,err=>{console.error(err);state.passages=[];renderDashboard();$('passageCount').textContent='Could not load passages';resolve();});
 });
 try{
  if(state.student.demo)state.sessions=[];
  else{const s=await read('readingFluency/sessions');state.sessions=Object.entries(s).map(([id,v])=>({id,...v})).filter(x=>x.studentId===state.student.id).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0));}
 }catch(e){console.error(e);state.sessions=[];}
 await first;renderDashboard();
}
function renderDashboard(){
 const ss=state.sessions, avg=k=>ss.length?Math.round(ss.reduce((a,s)=>a+(Number(s[k])||0),0)/ss.length):null;
 $('sessionsCount').textContent=ss.length;$('avgWpm').textContent=avg('wpm')??'—';$('avgAccuracy').textContent=avg('accuracy')===null?'—':avg('accuracy')+'%';$('avgScore').textContent=avg('overallScore')===null?'—':avg('overallScore')+'%';
 $('passageCount').textContent=state.passages.length+' passages';
 $('passageGrid').innerHTML=state.passages.length?state.passages.map(p=>`<article class="passage-card"><span class="tag">${esc(p.level||'All levels')}</span><h3>${esc(p.title)}</h3><p>${esc((p.text||'').slice(0,145))}${(p.text||'').length>145?'…':''}</p><div class="card-meta"><span class="tag">${tokens(p.text).length} words</span>${p.targetWpm?`<span class="tag">Target ${Number(p.targetWpm)} WPM</span>`:''}</div><button class="btn primary" data-read="${esc(p.id)}">Start passage →</button></article>`).join(''):'<div class="panel"><b>No passages available yet</b><p class="muted">Your teacher has not published a passage for reading yet.</p></div>';
 RFHistory.render($('historyList'),ss,x=>`<div class="history-row"><div><b>${esc(x.passageTitle||'Reading session')}</b><small>${dateLabel(x.completedAt||Date.now())} · ${x.wpm||0} WPM · ${x.accuracy||0}% accuracy</small></div><span class="score-chip">${Math.round(x.overallScore||0)}%</span></div>`);
 document.querySelectorAll('[data-read]').forEach(b=>b.addEventListener('click',()=>startPassage(b.dataset.read)));
}
async function startPassage(id){
 let p=null;
 if(db){try{const s=await root.child('readingFluency/passages/'+id).once('value');p=s.exists()?cleanPassage(id,s.val()):null;if(p&&!isPublished(p))p=null;}catch(e){console.error(e);p=state.passages.find(x=>x.id===id)||null;}}
 if(!p){$('passageCount').textContent='That passage was changed or removed';show('dashboardView');return;}
 stopRecognition();clearInterval(state.timer);
 state.active=p;state.vocab=new Set(tokens(p.text).map(wkey));state.transcript='';state.finalTranscript='';state.startedAt=null;state.endedAt=null;state.isListening=false;state.wordSpans=[];
 $('readingTitle').textContent=p.title;$('readingLevel').textContent=p.level||'Reading passage';const parts=(p.text||'').split(/(\s+)/);let wordIdx=0;
 $('passageText').innerHTML=parts.map(part=>{if(/^\s+$/.test(part))return esc(part);if(!part)return '';const id=wordIdx++;return `<span class="word" data-word-index="${id}">${esc(part)}</span>`;}).join('');
 state.wordSpans=[...$('passageText').querySelectorAll('.word')];$('targetWordCount').textContent=state.wordSpans.length+' words';$('elapsed').textContent='00:00';$('heardCount').textContent='0';$('liveWpm').textContent='0';$('startBtn').disabled=false;$('listenBtn').disabled=false;$('finishBtn').disabled=true;$('retryBtn').disabled=true;$('resultPanel').classList.add('hidden');$('readProgress').style.width='0';$('passageText').classList.remove('live');$('passageText').scrollTop=0;sayStatus('Press Start reading, allow microphone access, and read the passage aloud.');show('readingView');
}
// ---- Matching helpers: numbers, homophones and small recogniser slips ----
const NUMW={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100};
const HOMO=(()=>{const m={};[['to','too','2'],['there','their',"they're"],['here','hear'],['no','know'],['write','right'],['by','buy','bye'],['for','4','fore'],['won','1'],['see','sea'],['son','sun'],['be','bee'],['new','knew'],['our','hour'],['would','wood'],['whole','hole'],['week','weak'],['read','red'],['its',"it's"],['your',"you're"],['where','wear'],['meet','meat'],['made','maid'],['tail','tale'],['plain','plane'],['road','rode'],['sail','sale'],['flower','flour'],['mail','male'],['break','brake'],['piece','peace'],['wait','weight'],['bare','bear'],['dear','deer'],['8','ate'],['hi','high'],['i','eye'],['in','inn'],['rain','reign'],['some','sum'],['through','threw'],['which','witch']].forEach((g,k)=>g.forEach(w=>m[w]='~'+k));return m;})();
function wkey(w){let n=normalise(w);if(NUMW[n]!==undefined)n=String(NUMW[n]);return HOMO[n]||n;}
// strict=true is used for the final score; loose is used for live word tracking.
function same(a,b,strict){const x=wkey(a),y=wkey(b);if(!x||!y)return false;if(x===y)return true;if(x[0]==='~'||y[0]==='~')return false;const m=Math.min(x.length,y.length);if(m>=(strict?6:4)&&lev(x,y)<=1)return true;if(m>=(strict?10:8)&&lev(x,y)<=2)return true;return false;}
// When the recogniser offers several guesses, prefer the guess that uses words found in the passage.
function bestAlt(res){let best=(res[0]&&res[0].transcript)||'',bs=-1;const V=state.vocab;for(let k=0;k<res.length;k++){const t=(res[k]&&res[k].transcript)||'';let sc=k===0?.5:0;if(V)tokens(t).forEach(w=>{if(V.has(wkey(w)))sc++;});if(sc>bs){bs=sc;best=t;}}return best;}
// Some Android builds repeat earlier text inside each new final result. Drop a segment when the next one starts with it.
function dedupeSegs(list){const t=s=>tokens(s).map(normalise).join(' ');const out=[];list.forEach((s,i)=>{const cur=t(s),nxt=i+1<list.length?t(list[i+1]):'';if(cur&&nxt&&(nxt===cur||nxt.startsWith(cur+' ')))return;out.push(s);});return out;}
const LANGS=['en-NG','en-GB','en-US'];
function createRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)return null;const r=new SR();r.lang=sessionStorage.getItem('rfLang')||LANGS[0];r.continuous=true;r.interimResults=true;r.maxAlternatives=5;return r;
}
function rebuildTranscript(){state.finalTranscript=((state.committed||'')+' '+(state.segFinal||'')).trim();state.transcript=(state.finalTranscript+' '+(state.segInterim||'')).trim();$('heardCount').textContent=tokens(state.transcript).length;updateLive();}
function commitSeg(){state.committed=((state.committed||'')+' '+(state.segFinal||'')+' '+(state.segInterim||'')).trim();state.segFinal='';state.segInterim='';}
// Live microphone level (desktop only: phones can lose speech recognition when a second audio stream is open).
const Meter={ctx:null,raf:0,stream:null,
 bar(){let b=document.getElementById('micLevelBar');if(b)return b;const strip=document.querySelector('.live-strip');if(!strip)return null;const d=document.createElement('div');d.className='mic-meter';d.innerHTML='<span>Mic level</span><i><b id="micLevelBar"></b></i>';strip.insertAdjacentElement('afterend',d);return d.querySelector('b');},
 async start(){this.stop();if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||!navigator.mediaDevices)return;const bar=this.bar();if(!bar)return;
  try{const s=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!state.isListening){s.getTracks().forEach(t=>t.stop());return;}this.stream=s;const AC=window.AudioContext||window.webkitAudioContext;this.ctx=new AC();const an=this.ctx.createAnalyser();an.fftSize=512;this.ctx.createMediaStreamSource(s).connect(an);const d=new Uint8Array(an.fftSize);
   const tick=()=>{an.getByteTimeDomainData(d);let m=0;for(let k=0;k<d.length;k++)m=Math.max(m,Math.abs(d[k]-128));bar.style.width=Math.min(100,Math.round(m/128*220))+'%';this.raf=requestAnimationFrame(tick);};tick();}catch(e){}},
 stop(){cancelAnimationFrame(this.raf);if(this.stream){this.stream.getTracks().forEach(t=>t.stop());this.stream=null;}if(this.ctx){try{this.ctx.close();}catch(e){}this.ctx=null;}const b=document.getElementById('micLevelBar');if(b)b.style.width='0';}};
function startReading(){
 if(!state.active)return;
 const rec=createRecognition();if(!rec){sayStatus('Speech recognition is not supported in this browser. Please use an up-to-date Chrome or Edge browser.');return;}
 stopVoice();Ear.stop();state.recognition=rec;$('listenBtn').disabled=true;state.startedAt=Date.now();state.endedAt=null;state.transcript='';state.finalTranscript='';state.committed='';state.segFinal='';state.segInterim='';state.fails=0;state.lastHeard=Date.now();state.quietShown=false;state.isListening=true;$('passageText').classList.add('live');trackProgress();
 $('startBtn').disabled=true;$('finishBtn').disabled=false;$('retryBtn').disabled=true;sayStatus('Listening… Read aloud at a natural pace. Keep reading if you make a mistake.');
 rec.onresult=e=>{const fin=[],interim=[];for(let k=0;k<e.results.length;k++){const r=e.results[k];(r.isFinal?fin:interim).push(bestAlt(r));}
  state.segFinal=dedupeSegs(fin).join(' ');state.segInterim=interim.join(' ');state.lastHeard=Date.now();state.fails=0;rebuildTranscript();};
 rec.onerror=e=>{if(micLost(e))return;const er=e.error;if(er==='no-speech'||er==='aborted')return;state.fails++;
  if(er==='language-not-supported'){const k=Math.max(0,LANGS.indexOf(rec.lang))+1;rec.lang=LANGS[k]||'en-US';sessionStorage.setItem('rfLang',rec.lang);sayStatus('Switching speech recognition to '+rec.lang+'…');return;}
  if(er==='audio-capture'){sayStatus('No working microphone was found. Check that a microphone is connected and selected, then try again.');return;}
  if(er==='network'){sayStatus('Speech recognition needs an internet connection. Check your connection; I will keep trying.');return;}
  sayStatus(`Speech recognition issue: ${er}. I will keep trying. If it continues, finish the session and try again.`);};
 rec.onend=()=>{if(state.recognition!==rec)return;commitSeg();if(!state.isListening)return;setTimeout(()=>{if(state.isListening&&state.recognition===rec){try{rec.start();}catch(err){}}},Math.min(150+state.fails*500,4000));};
 try{rec.start();}catch(e){sayStatus('Could not start microphone. Check permissions and try again.');state.isListening=false;$('startBtn').disabled=false;$('listenBtn').disabled=false;$('finishBtn').disabled=true;return;}
 state.timer=setInterval(updateLive,500);Meter.start();
}
function updateLive(){if(!state.startedAt)return;trackProgress();if(state.isListening){const quiet=Date.now()-(state.lastHeard||state.startedAt);if(quiet>10000&&!state.quietShown){state.quietShown=true;sayStatus('I cannot hear you yet. Move closer to the microphone, speak a little louder and check that the right microphone is selected.');}else if(quiet<=10000&&state.quietShown){state.quietShown=false;sayStatus('Listening… Read aloud at a natural pace. Keep reading if you make a mistake.');}}const secs=Math.max(1,Math.floor(((state.endedAt||Date.now())-state.startedAt)/1000));$('elapsed').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');$('liveWpm').textContent=Math.round(tokens(state.transcript).length/(secs/60));}
function stopRecognition(){stopTry();Ear.stop();Meter.stop();state.isListening=false;if(state.recognition){try{state.recognition.onend=null;state.recognition.stop();}catch(e){}state.recognition=null;}if(state.timer){clearInterval(state.timer);state.timer=null;}}
function compareWords(expectedText,spokenText){
 const exp=tokens(expectedText), got=tokens(spokenText), a=exp.map(normalise), b=got.map(normalise), n=a.length,m=b.length;
 // Levenshtein alignment: insertion=extra, deletion=omission, substitution=likely misread.
 const dp=Array.from({length:n+1},()=>Array(m+1).fill(0)), bt=Array.from({length:n+1},()=>Array(m+1).fill(''));
 for(let i=0;i<=n;i++){dp[i][0]=i;if(i)bt[i][0]='delete';}for(let j=0;j<=m;j++){dp[0][j]=j;if(j)bt[0][j]='insert';}
 for(let i=1;i<=n;i++)for(let j=1;j<=m;j++){const cost=same(exp[i-1],got[j-1],true)?0:1;const choices=[[dp[i-1][j-1]+cost,'match'],[dp[i-1][j]+1,'delete'],[dp[i][j-1]+1,'insert']].sort((x,y)=>x[0]-y[0]);dp[i][j]=choices[0][0];bt[i][j]=choices[0][1];}
 const aligned=[], issues=[];let i=n,j=m,matched=0,sub=0,omitted=0,extra=0;
 while(i>0||j>0){const op=bt[i][j];if(i>0&&j>0&&op==='match'){if(same(exp[i-1],got[j-1],true)){matched++;aligned.push({expected:exp[i-1],spoken:got[j-1],type:'correct'});}else{sub++;issues.push({expected:exp[i-1],spoken:got[j-1],type:'substitution'});aligned.push({expected:exp[i-1],spoken:got[j-1],type:'substitution'});}i--;j--;}else if(i>0&&(j===0||op==='delete')){omitted++;issues.push({expected:exp[i-1],spoken:'',type:'omission'});aligned.push({expected:exp[i-1],spoken:'',type:'omission'});i--;}else if(j>0){extra++;issues.push({expected:'',spoken:got[j-1],type:'extra'});j--;}}
 aligned.reverse();
 return {expectedCount:n,spokenCount:m,matched,substitutions:sub,omissions:omitted,extras:extra,issues,aligned,wordAccuracy:n?Math.max(0,matched/n*100):0,editDistance:dp[n][m]};
}
async function finishReading(){
 if(!state.startedAt||!state.active)return;state.endedAt=Date.now();stopRecognition();updateLive();$('passageText').classList.remove('live');$('finishBtn').disabled=true;$('listenBtn').disabled=false;$('retryBtn').disabled=false;sayStatus('Calculating your reading report…');
 if(!tokens(state.transcript||state.finalTranscript).length){sayStatus('No reading was recognised, so nothing was saved. Check the microphone level, then press Start reading and try again.');$('startBtn').disabled=false;$('retryBtn').disabled=false;state.startedAt=null;return;}
 const elapsedSec=Math.max(1,(state.endedAt-state.startedAt)/1000), expected=state.active.text||'', spoken=state.transcript||state.finalTranscript||'', c=compareWords(expected,spoken);
 const wpm=Math.round(((c.matched+c.substitutions)||c.spokenCount)/(elapsedSec/60)), accuracy=Math.round(c.wordAccuracy*10)/10;
 // Browser speech recognition cannot reliably isolate phoneme-level pronunciation. Use word-match rate as an explicit pronunciation proxy.
 const pronunciation=Math.round(c.wordAccuracy*10)/10, target=Number(state.active.targetWpm)||100;
 const speed=Math.max(0,Math.min(100,(wpm/target)*100));
 const durationFactor=Math.min(1,elapsedSec/Math.max(20,c.expectedCount*0.2)); // discourage implausibly short empty sessions
 const overall=Math.round((pronunciation*.35+speed*.20+accuracy*.35+Math.min(100,Math.max(0,100-c.editDistance/Math.max(1,c.expectedCount)*100))*.10)*durationFactor*10)/10;
 const result={id:uuid(),studentId:state.student.id,studentName:state.student.name||'Reader',passageId:state.active.id,passageTitle:state.active.title,completedAt:state.endedAt,durationSeconds:Math.round(elapsedSec),wpm,accuracy,pronunciationScore:pronunciation,speedScore:Math.round(speed*10)/10,overallScore:overall,expectedCount:c.expectedCount,spokenCount:c.spokenCount,matched:c.matched,substitutions:c.substitutions,omissions:c.omissions,extras:c.extras,transcript:spoken,issues:c.issues};
 sessionStorage.setItem('rfLastResult',JSON.stringify(result));
 try{if(!state.student.demo)await save('readingFluency/sessions/'+result.id,result);state.sessions.unshift(result);}catch(e){console.error(e);sayStatus('Report calculated, but could not save to Firebase. Check your database rules and connection.');}
 renderResult(result,c);sayStatus('Session complete. Review the report and practise the words marked for attention.');
}

const vs={token:0,voice:null,active:false,src:'',rate:parseFloat(localStorage.getItem('rfRate'))||0.9};
if('speechSynthesis' in window)speechSynthesis.onvoiceschanged=()=>{vs.voice=null;};
function pickVoice(){if(vs.voice)return vs.voice;const score=v=>{const n=(v.name||'').toLowerCase(),l=(v.lang||'').toLowerCase();let s=0;if(/natural|neural|online/i.test(n))s+=100;if(/aria|jenny|sonia|zira|samantha|victoria|serena|hazel|libby|natasha|ava|allison|karen|moira|tessa|female|woman/i.test(n))s+=120;if(/google uk english female|google us english female/i.test(n))s+=140;if(/en-ng/.test(l))s+=25;else if(/en-gb/.test(l))s+=20;else if(/en-us/.test(l))s+=15;else if(/^en/.test(l))s+=5;return s;};const ranked=speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)).map(v=>({v,s:score(v)})).sort((a,b)=>b.s-a.s);return vs.voice=ranked.length&&ranked[0].s>=100?ranked[0].v:null;}
function syncBtns(){const l=$('listenBtn'),g=$('hearGuide');if(l)l.textContent=vs.active&&vs.src==='listen'?'■ Stop listening':'🎧 Listen first';if(g)g.textContent=vs.active&&vs.src==='guide'?'■ Stop guide':'🎧 Listen to how it works';}
// Real human portrait avatar: animate the portrait card while speech synthesis is active.
const Avatar=(()=>{
 const els=()=>({root:document.getElementById('coachDock')||document.getElementById('avatarBox'),cap:document.getElementById('dockCoachSays')||document.getElementById('coachSays')});
 return {begin(){const {root}=els();if(root)root.classList.add('speaking');},word(){const {root}=els();if(root)root.classList.add('speaking');},rest(){},stop(){const {root}=els();if(root)root.classList.remove('speaking');},caption(t){const {cap}=els();if(cap)cap.textContent=t;}};
})();
function clearHL(){document.querySelectorAll('.word.current,.guide-step.active,.correction-card.speaking').forEach(e=>e.classList.remove('current','active','speaking'));}
function chunks(text){const w=String(text||'').trim().split(/\s+/).filter(Boolean),out=[];let cur=[],len=0,start=0;
 w.forEach((x,i)=>{cur.push(x);len+=x.length+1;if(/[.!?]["”’)]?$/.test(x)||len>150){out.push({text:cur.join(' '),first:start,words:cur});cur=[];len=0;start=i+1;}});
 if(cur.length)out.push({text:cur.join(' '),first:start,words:cur});return out;}
// speak(text | [{text,onstart,rate}], {spans,onend,src}): sentence-by-sentence for natural speech. The page stays fully active while the coach talks and the avatar lip-syncs.
function speak(input,o={}){
 if(!('speechSynthesis' in window)){sayStatus('Read-aloud voice is not supported here. Use an updated Chrome, Edge or Safari.');if(o.onend)o.onend(false);return;}
 const synth=speechSynthesis;synth.cancel();const my=++vs.token,list=Array.isArray(input)?input:[{text:input}],queue=[];
 list.forEach(it=>chunks(it.text).forEach((c,i)=>queue.push({...c,rate:it.rate,onstart:i?null:it.onstart})));
 if(!queue.length){if(o.onend)o.onend(false);return;}
 const voice=pickVoice();if(!voice){sayStatus('No clearly identifiable English female voice is available on this device. Enable/install a natural female English voice in your system voice settings, then reload.');if(o.onend)o.onend(false);return;}vs.active=true;vs.src=o.src||'';syncBtns();
 const done=ok=>{if(my!==vs.token)return;vs.active=false;vs.src='';syncBtns();Avatar.stop();clearHL();if(o.onend)o.onend(ok);};let i=0;
 const next=()=>{if(my!==vs.token)return;if(i>=queue.length)return done(true);const c=queue[i++],u=new SpeechSynthesisUtterance(c.text);
  u.voice=voice;u.lang=voice.lang;u.rate=c.rate||vs.rate;u.pitch=1.02;
  u.onstart=()=>{if(my!==vs.token)return;Avatar.begin(c.text,u.rate);Avatar.caption(c.text);if(c.onstart)c.onstart();};
  u.onboundary=e=>{if(my!==vs.token||e.name==='sentence')return;let p=0,k=0;for(;k<c.words.length-1;k++){if(e.charIndex<p+c.words[k].length+1)break;p+=c.words[k].length+1;}
   Avatar.word(c.words[k],u.rate);
   const sp=o.spans&&o.spans[c.first+k];if(sp){document.querySelectorAll('.word.current').forEach(x=>x.classList.remove('current'));sp.classList.add('current');follow(sp);}};
  u.onend=()=>{if(my!==vs.token)return;Avatar.rest();setTimeout(next,/[.!?]["”’)]?$/.test(c.text)?240:90);};
  u.onerror=ev=>{if(my===vs.token&&ev.error!=='interrupted'&&ev.error!=='canceled')done(false);};
  synth.speak(u);};
 setTimeout(next,80);}
function lev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];}
const close=(a,b)=>same(a,b,false);
// Keep the current word centred inside the passage window (never scrolls the page)
function follow(el){const w=$('passageText');if(!el||!w)return;w.scrollTo({top:Math.max(0,el.offsetTop-w.clientHeight/2+el.offsetHeight/2),behavior:'smooth'});}
// Live tracking: aligns what the student has said so far to the passage, so the text "loads" at the reader's pace
function trackProgress(){
 const sp=state.wordSpans;if(!sp.length)return;const exp=sp.map(s=>normalise(s.textContent)),got=tokens(state.transcript).map(normalise),st=new Array(exp.length).fill('');let pos=0;
 got.forEach(g=>{if(!g)return;for(let k=pos;k<Math.min(exp.length,pos+8);k++){if(close(exp[k],g)){for(let m=pos;m<k;m++)st[m]='skipped';st[k]='correct';pos=k+1;return;}}});
 sp.forEach((x,i)=>{x.classList.toggle('correct',st[i]==='correct');x.classList.toggle('skipped',st[i]==='skipped');x.classList.toggle('upcoming',i>=pos);x.classList.toggle('current',i===pos&&state.isListening);});
 $('readProgress').style.width=Math.round(pos/exp.length*100)+'%';
 if(state.isListening){if(pos<exp.length)follow(sp[pos]);else sayStatus('You reached the end of the passage. Press Finish session.');}}
// Coach practice (not saved)
let trySession=0;
function stopTry(){trySession++;Ear.finish({alts:[]});if(state.tryRec){try{state.tryRec.onend=null;state.tryRec.abort();}catch(e){}state.tryRec=null;}document.querySelectorAll('.correction-card.trying,.word-card.trying').forEach(e=>e.classList.remove('trying'));}
function gradeWord(target,alts){const t=normalise(target);let best=0,heard='';alts.forEach(a=>tokens(a).forEach(w=>{const n=normalise(w),sim=same(n,t,true)?1:Math.max(0,1-lev(n,t)/Math.max(n.length,t.length));if(sim>best){best=sim;heard=w;}}));return {score:Math.round(best*100),heard,pass:best>=1||(t.length>=5&&best>=.85)};}
// One long-lived speech recogniser for word practice: it is started once and reused for every attempt, so the browser is not asked for the microphone again and again.
const Ear={rec:null,on:false,pending:null,timer:null,
 ensure(){if(this.rec)return true;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return false;
  const r=new SR();r.lang='en-NG';r.continuous=true;r.interimResults=false;r.maxAlternatives=5;
  r.onresult=e=>{const res=e.results[e.results.length-1];if(!this.pending||!res)return;this.finish({alts:[...res].map(a=>a.transcript)});};
  r.onerror=e=>{if(e.error==='no-speech'||e.error==='aborted')return;if(e.error==='language-not-supported'){r.lang='en-GB';return;}if(e.error==='not-allowed'||e.error==='service-not-allowed'){this.on=false;this.rec=null;}this.finish({error:e.error});};
  r.onend=()=>{if(this.on&&this.rec===r){try{r.start();}catch(err){}}};
  this.rec=r;return true;},
 start(){if(!this.ensure())return false;if(!this.on){this.on=true;try{this.rec.start();}catch(e){}}return true;},
 listen(ms=7000){return new Promise(res=>{this.finish({alts:[]});if(!this.start())return res({error:'unsupported'});this.pending=res;this.timer=setTimeout(()=>this.finish({alts:[]}),ms);});},
 finish(v){clearTimeout(this.timer);const p=this.pending;this.pending=null;if(p)p(v);},
 stop(){this.on=false;this.finish({alts:[]});if(this.rec){const r=this.rec;this.rec=null;try{r.onend=null;r.abort();}catch(e){}}}
};
function listenOnce(){return Ear.listen();}
function stopVoice(){vs.token++;if('speechSynthesis' in window)speechSynthesis.cancel();vs.active=false;vs.src='';syncBtns();Avatar.stop();clearHL();}
window.addEventListener('pagehide',stopVoice);
function correctionSpeech(issue,index,total){
 if(issue.type==='omission')return `Correction ${index+1} of ${total}. The word to practise is ${issue.expected}. Listen carefully: ${issue.expected}. Now say the word aloud yourself. Then read it again in the passage. You can replay this correction as many times as you need.`;
 if(issue.type==='extra')return `Correction ${index+1} of ${total}. You said ${issue.spoken}, but the speech checker did not find that word in this part of the passage. Listen to the passage again and follow the printed words carefully.`;
 return `Correction ${index+1} of ${total}. The word in the passage is ${issue.expected}. The speech checker heard ${issue.spoken}. Listen to the correct word: ${issue.expected}. Now say ${issue.expected} aloud slowly, then say it once more at your normal reading speed.`;
}
// All coach views use the same photorealistic MathCloud human guide image.
// Keep the animated coach visible beside the reading window; its mouth animation follows the browser speech voice.
const dockAvatar=document.getElementById('dockAvatar');
// Keep the photorealistic MathCloud guide image supplied by portal.html; speech status animates the portrait card.
if(dockAvatar){const talk=document.getElementById('dockCoachTalk');if(talk)talk.addEventListener('click',()=>speak('Hello, reader! I am your MathCloud reading coach. Read at your natural pace, look carefully at each word, and keep going if you make a mistake. I am here to help you practise.',{src:'dock'}));}
function renderResult(r,c){
 $('resultPanel').classList.remove('hidden');
 const all=(r.issues||[]).slice(0,100),items=all.filter(x=>x.type!=='extra'),extras=all.filter(x=>x.type==='extra'),total=items.length,nm=state.student.name||'reader';
 const greeting=total?`Hi ${nm}! I am Coach Reed. Press “Hear word” and I will say each word for you.`:`Well done, ${nm}! I did not find any words for you to practise.`;
 const stageHtml=`<div class="coach-stage"><div class="avatar-box" id="avatarBox"><img src="mathcloud-human-guide.png" alt="MathCloud human reading coach" loading="lazy"></div><div class="coach-bubble"><b>Coach Reed</b><p id="coachSays">${esc(greeting)}</p></div></div>`;
 const toolbar=`<div class="voice-toolbar"><button class="btn ghost" id="sessionSummaryVoice">🎧 Explain my session</button><button class="btn ghost" id="readPassageVoice">🔊 Read the passage</button>${total?'<button class="btn ghost" id="listenAllCorrections">▶ Hear all words</button><button class="btn primary" id="practiseAll">🎤 Practise all words</button>':''}<button class="btn danger" id="stopCoachVoice">■ Stop voice</button></div>`;
 const hub=total?`<section class="practice-hub" id="practiceHub"><div class="practice-progress"><div class="pp-line"><b id="ppText">0 of ${total} words practised</b><span id="ppPos">Word 1 of ${total}</span></div><div class="progress-track"><span id="ppBar" style="width:0%"></span></div></div>${stageHtml}<div id="wordStage" class="word-stage"></div><div class="word-nav"><button class="btn ghost" id="prevWord">← Previous</button><span id="navCount" class="nav-count">1 / ${total}</span><button class="btn primary" id="nextWord">Next →</button></div>${toolbar}</section>`
  :`<section class="practice-hub" id="practiceHub"><div class="practice-progress"><div class="pp-line"><b>No words to practise</b><span>All clear</span></div><div class="progress-track"><span style="width:100%"></span></div></div>${stageHtml}<div class="success-coach"><span>🎉</span><div><b>Excellent work!</b><p>No word differences were detected by the speech checker. Listen to the passage and read it once more to build confidence.</p></div></div>${toolbar}</section>`;
 $('resultPanel').innerHTML=`<div class="panel results-shell"><div class="result-head"><div><span class="eyebrow">YOUR READING REVIEW</span><h2>Great effort, ${esc(state.student.name||'reader')}!</h2><p class="muted">Let’s learn from this reading and grow stronger together.</p></div><div class="result-score">${r.overallScore}%<small style="display:block;font:600 .72rem 'DM Sans';color:var(--muted)">Overall score</small></div></div>
 <div class="result-grid"><div class="result-metric"><small>Reading pace</small><strong>${r.wpm} <small>WPM</small></strong></div><div class="result-metric"><small>Word accuracy</small><strong>${r.accuracy}%</strong></div><div class="result-metric"><small>Word-match estimate</small><strong>${r.pronunciationScore}%</strong></div><div class="result-metric"><small>Speed score</small><strong>${r.speedScore}%</strong></div></div>
 <div class="result-grid"><div class="result-metric"><small>Words matched</small><strong>${r.matched}/${r.expectedCount}</strong></div><div class="result-metric"><small>Possible substitutions</small><strong>${r.substitutions}</strong></div><div class="result-metric"><small>Words missed</small><strong>${r.omissions}</strong></div><div class="result-metric"><small>Extra words</small><strong>${r.extras}</strong></div></div>
 <span class="eyebrow">LISTEN • LEARN • TRY AGAIN</span><h3 class="correction-section-title" style="margin-top:0">${total?'Your personal word practice':'You read this passage well!'}</h3>
 ${hub}
 ${extras.length?`<p class="report-note"><b>Extra words heard:</b> ${extras.map(x=>esc(x.spoken)).join(', ')}. These may simply be background sounds or recognition noise, so there is nothing to practise here.</p>`:''}
 <p class="report-note"><b>A note about accuracy:</b> the browser listens for words and compares them with the passage; it cannot reliably judge individual speech sounds or prove that a word was mispronounced. Accents, names, microphone quality and background noise can affect recognition. Treat each flagged item as a practice suggestion, not a confirmed error.</p>
 <div class="session-controls report-bottom"><button class="btn primary" id="reportDashboard">Return to dashboard</button><button class="btn ghost" id="reportRetry">Read again</button></div></div>`;

 const practised=new Set(),skipped=new Set();let cur=0;
 const stage=$('wordStage'),fb=(html,cls='')=>{const e=$('tfx');if(e){e.className='try-feedback '+cls;e.innerHTML=html;}};
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),say=(t,o)=>new Promise(r=>speak(t,{...o,onend:r}));
 function updateUI(){if(!total)return;$('ppText').textContent=`${practised.size} of ${total} words practised`;$('ppBar').style.width=(practised.size/total*100)+'%';$('ppPos').textContent=`Word ${cur+1} of ${total}`;$('navCount').textContent=`${cur+1} / ${total}`;$('prevWord').disabled=cur===0;$('nextWord').disabled=cur===total-1;$('practiceHub').classList.toggle('all-done',practised.size===total);}
 function paintDone(){const b=$('doneBtn'),cd=$('wordCard');if(!b||!cd)return;const on=practised.has(cur);b.classList.toggle('marked-done',on);b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'✓ Practised!':'✓ I practised this';cd.classList.toggle('is-done',on);}
 function mark(i,on){if(on)practised.add(i);else practised.delete(i);if(i===cur)paintDone();updateUI();}
 function renderWord(dir){
  const x=items[cur],om=x.type==='omission';
  const expl=om?`The word “${x.expected}” appears in the passage but was not recognised in your reading.`:`The passage says “${x.expected}”, while the speech checker heard “${x.spoken}”. This may be a reading difference or a recognition mistake.`;
  stage.innerHTML=`<article class="word-card ${dir?'slide-'+dir:''}" id="wordCard"><span class="correction-type">${om?'Word missed':'Try this word again'}</span><div class="big-word">${esc(x.expected)}</div>${om?'':`<p class="heard-line">Speech checker heard: <b>${esc(x.spoken)}</b></p>`}<p class="word-expl">${esc(expl)}</p><div class="correction-actions"><button class="btn ghost" id="hearBtn">🔊 Hear word</button><button class="btn primary" id="tryBtn">🎤 Practise saying it</button><button class="btn ghost hidden" id="skipBtn">Skip for now</button><button class="btn ghost correction-practised" id="doneBtn" aria-pressed="false">✓ I practised this</button></div><div class="try-feedback" id="tfx" aria-live="polite"></div></article>`;
  $('hearBtn').onclick=()=>{stopTry();speak(correctionSpeech(x,cur,total));};
  $('tryBtn').onclick=()=>{stopVoice();stopTry();practiseWord(cur);};
  $('skipBtn').onclick=()=>{skipped.add(cur);if(state.tryRec){try{state.tryRec.abort();}catch(e){}}fb('Skipped for now. You can practise this word again any time.');$('skipBtn').classList.add('hidden');};
  $('doneBtn').onclick=()=>mark(cur,!practised.has(cur));
  paintDone();updateUI();
  if(!vs.active)Avatar.caption(`Ready? Press “Hear word” and I will say “${x.expected}” for you.`);}
 const go=(i,dir)=>{cur=i;renderWord(dir);};
 const goUser=i=>{if(i<0||i>=total||i===cur)return;stopVoice();stopTry();const dir=i>cur?'next':'prev';go(i,dir);};
 // Coach says the word, student says it, the browser grades it, and the loop repeats until it is right (nothing is saved)
 async function practiseWord(i){
  const issue=items[i];if(!issue)return true;const my=trySession,word=issue.expected;let n=0;skipped.delete(i);
  const card=()=>$('wordCard');
  while(my===trySession&&!skipped.has(i)&&i===cur){
   n++;card()?.classList.add('trying');fb(n===1?'Listen to the coach, then say the word.':`Attempt ${n}. Listen again, then say the word.`,'listening');
   await say([{text:n===1?`Let us practise. Say the word: ${word}.`:`Not quite. Listen again: ${word}.`},{text:word,rate:.6},{text:'Now you say it.'}]);
   if(my!==trySession||skipped.has(i))break;await wait(300);
   fb('🎤 Listening… say the word now.','listening');const out=await listenOnce();if(my!==trySession||skipped.has(i))break;
   if(['not-allowed','service-not-allowed','unsupported'].includes(out.error)){fb('The microphone is not available. Turn it on, then try again.','bad');stopTry();if(out.error!=='unsupported'){mic.ok=false;sessionStorage.removeItem('rfMic');ensureMic();}return false;}
   const g=out.alts&&out.alts.length?gradeWord(word,out.alts):{score:0,heard:'',pass:false};
   if(g.pass){fb(`✅ Correct! You said “${esc(g.heard)}” (${g.score}% match). Practice scores are not saved.`,'good');card()?.classList.remove('trying');$('skipBtn')?.classList.add('hidden');mark(i,true);await say('Excellent! That is correct.');return true;}
   fb(g.heard?`I heard “${esc(g.heard)}” (${g.score}% match). Let us try again.`:'I did not hear you clearly. Let us try again.','bad');
   if(n>=3)$('skipBtn')?.classList.remove('hidden');
  }
  card()?.classList.remove('trying');return false;}
 if(total){
  renderWord();
  $('prevWord').onclick=()=>goUser(cur-1);$('nextWord').onclick=()=>goUser(cur+1);
  $('resultPanel').onkeydown=e=>{if(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;if(e.key==='ArrowRight')goUser(cur+1);else if(e.key==='ArrowLeft')goUser(cur-1);};
  $('listenAllCorrections').onclick=()=>{stopTry();speak(items.map((x,i)=>({text:correctionSpeech(x,i,total),onstart:()=>go(i)})),{onend:ok=>{if(ok)Avatar.caption('Great listening! Practise any word whenever you are ready.');}});};
  $('practiseAll').onclick=async()=>{stopVoice();stopTry();const my=trySession,order=[...items.keys()].map(k=>(k+cur)%total).filter(i=>!practised.has(i));
   if(!order.length){speak('You have practised every word. Well done! Now read the passage again to see how much you have improved.');return;}
   for(const i of order){if(my!==trySession)return;go(i);await practiseWord(i);}
   if(my===trySession)speak(practised.size===total?'Well done! You have worked through all the words. Now read the passage again to see your progress.':'Good work. You can come back to the skipped words any time.');};
 }else $('resultPanel').onkeydown=null;
 $('sessionSummaryVoice').onclick=()=>speak(`Here is your reading session report, ${state.student.name||'reader'}. You read ${r.expectedCount} words in the passage. Your reading speed was ${r.wpm} words per minute. Your word accuracy was ${r.accuracy} percent. Your overall fluency score was ${r.overallScore} percent. The speech checker matched ${r.matched} words. It flagged ${r.substitutions} possible substitutions, ${r.omissions} words it may not have heard, and ${r.extras} possible extra words. Please remember that speech recognition can make mistakes because of accents, background noise, or microphone quality. These are practice clues, not proof that you pronounced a word incorrectly. ${total?`You have ${total} words to practise. Listen to the coach, practise slowly, and then read the passage again.`:'No word differences were detected. Keep practising to build smooth, confident reading.'} Well done for completing your session.`);
 $('readPassageVoice').onclick=()=>speak(`Let's read the passage together. Listen first. ${state.active?.text||''} That was the passage. Now try reading it yourself at a steady pace.`);
 $('stopCoachVoice').onclick=()=>{stopVoice();stopTry();Avatar.caption('Okay, I am quiet now. Press any button when you want me to talk again.');sayStatus('Read-aloud coach stopped. Choose any word to continue.');};
 $('reportDashboard').onclick=()=>{stopVoice();stopTry();Ear.stop();loadDashboard();};
 $('reportRetry').onclick=()=>{stopVoice();stopTry();startPassage(state.active.id);};
 renderDashboard();
 // Give the learner five calm seconds to see the report before Coach Reed explains it.
 // Then transition smoothly to the coach and the first word needing attention.
 const autoCoachTimer=setTimeout(()=>{
  if(!$('resultPanel')||$('resultPanel').classList.contains('hidden'))return;
  $('resultPanel').scrollIntoView({behavior:'smooth',block:'start'});
  const summary=`Well done, ${state.student.name||'reader'}! Your reading session is complete. You read at ${r.wpm} words per minute, with a word-match estimate of ${r.accuracy} percent. Remember, speech recognition can miss words, so these suggestions are for practice, not proof of a mistake. ${total?`I found ${total} word${total===1?'':'s'} we can practise together. Let us listen carefully to the first one.`:'I did not find any words needing attention. Listen to the passage and keep building your confidence.'}`;
  const queue=[{text:summary}];
  if(total)queue.push({text:correctionSpeech(items[0],0,total),onstart:()=>{const hub=$('practiceHub');if(hub)hub.scrollIntoView({behavior:'smooth',block:'start'});}});
  speak(queue,{src:'auto-review',onend:ok=>{if(ok&&total)Avatar.caption(`Let's practise “${items[0].expected}” together. Press Practise saying it when you are ready.`);}});
 },5000);
}
$('passcodeForm').addEventListener('submit',e=>{e.preventDefault();$('loginError').textContent='';login($('passcode').value).catch(err=>{$('loginError').textContent='Unable to connect. Check your internet and Firebase configuration.';console.error(err);});});
$('logoutBtn').onclick=()=>{stopPassageFeed();sessionStorage.removeItem('rfStudent');sessionStorage.removeItem('rfPasscode');state.student=null;Ear.stop();releaseMic();show('loginView');};
$('startBtn').onclick=startReading;$('finishBtn').onclick=finishReading;$('retryBtn').onclick=()=>state.active&&startPassage(state.active.id);$('backBtn').onclick=()=>{stopRecognition();loadDashboard();};

const guideText=['Welcome to MathCloud Reading Fluency. Here is how it works.','Step one. Type the passcode from your teacher, then press Open my dashboard. You will be asked to turn on your microphone one time only.','Step two. Choose a passage. Press Listen first to hear it read aloud, with each word lighting up as you listen.','Step three. Press Start reading, and read aloud at a natural pace. Press Finish session when you are done.','Step four. Read your report. Your coach shows one word at a time. Press Practise saying it and say the word. The coach tells you if it is right, and asks you to try again until you get it. Use Next and Previous to move between words.','One helpful tip. The page stays active while I talk, so you can press any button at any time. Press Stop voice whenever you want me to be quiet.'];
$('hearGuide').onclick=()=>{if(vs.active&&vs.src==='guide'){stopVoice();return;}speak(guideText.map((t,i)=>({text:t,onstart:()=>{document.querySelectorAll('.guide-step').forEach((e,k)=>e.classList.toggle('active',k===i-1));}})),{src:'guide'});};
$('voiceRate').value=String(vs.rate);$('voiceRate').onchange=e=>{vs.rate=parseFloat(e.target.value);localStorage.setItem('rfRate',vs.rate);speak('This is how fast I will read.');};
$('listenBtn').onclick=()=>{if(vs.active&&vs.src==='listen'){stopVoice();return;}if(state.wordSpans.length)speak(state.wordSpans.map(x=>x.textContent).join(' '),{spans:state.wordSpans,src:'listen'});};

// ---- Microphone: asked for ONCE, straight after the passcode is accepted. After that it just works. ----
const mic={ok:false,stream:null};let micResolve=null;
const micMsg=(t,cls)=>{const m=$('micMsg');m.textContent=t;m.className='mic-msg '+(cls||'');};
function micGranted(){try{if(navigator.permissions&&navigator.permissions.query)return navigator.permissions.query({name:'microphone'}).then(p=>p.state==='granted',()=>sessionStorage.getItem('rfMic')==='1');}catch(e){}return Promise.resolve(sessionStorage.getItem('rfMic')==='1');}
function closeGate(){$('micGate').classList.add('hidden');document.body.classList.remove('gate-open');}
function ensureMic(){
 if(mic.ok)return Promise.resolve();
 return micGranted().then(ok=>{if(ok){mic.ok=true;return;}
  return new Promise(res=>{micResolve=res;micMsg(window.isSecureContext?'':'This page is not on a secure (https) address, so the browser may keep asking for the microphone. Ask your administrator to host it on https.','bad');$('micHelp').classList.add('hidden');$('micEnable').textContent='🎤 Turn on microphone';$('micEnable').disabled=false;$('micGate').classList.remove('hidden');document.body.classList.add('gate-open');setTimeout(()=>$('micEnable').focus(),60);});});}
$('micEnable').onclick=async()=>{
 const b=$('micEnable');
 if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){micMsg('This browser cannot reach a microphone. Please use an up-to-date Chrome or Edge on a secure (https) address.','bad');return;}
 b.disabled=true;micMsg('Waiting for you to choose “Allow” in your browser…','wait');
 try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop());mic.stream=null;mic.ok=true;sessionStorage.setItem('rfMic','1');micMsg('✅ Microphone permission granted. Read a short test sentence to confirm that speech is being recognised.','good');setTimeout(()=>{closeGate();const r=micResolve;micResolve=null;if(r)r();},700);}
 catch(e){b.disabled=false;b.textContent='🎤 Try again';$('micHelp').classList.remove('hidden');micMsg(e&&e.name==='NotFoundError'?'No microphone was found. Connect one and press Try again.':'Microphone access is blocked. Allow it using the steps below, then press Try again.','bad');}};
$('micSignOut').onclick=()=>{micResolve=null;closeGate();$('logoutBtn').click();};
function releaseMic(){if(mic.stream){mic.stream.getTracks().forEach(t=>t.stop());mic.stream=null;}mic.ok=false;}
// If the browser ever withdraws the permission mid-session, ask again (the only other time the prompt can appear)
function micLost(e){
 if(e.error!=='not-allowed'&&e.error!=='service-not-allowed')return false;
 stopRecognition();state.startedAt=null;$('startBtn').disabled=false;$('finishBtn').disabled=true;$('listenBtn').disabled=false;$('passageText').classList.remove('live');
 mic.ok=false;sessionStorage.removeItem('rfMic');sayStatus('The microphone permission is unavailable. Re-enable it and check that the correct input device is selected.');
 ensureMic().then(()=>sayStatus('Microphone is ready. Press Start reading.'));return true;}
noticeConfig();restore().catch(console.error);
})();