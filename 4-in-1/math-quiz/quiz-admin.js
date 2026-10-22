(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>esc(s).replace(/\^(-?\d+)/g,'<sup>$1</sup>').replace(/sqrt\(/g,'√(');
const LET='ABCD';
const nid=p=>p+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
const when=ms=>ms?new Date(ms).toLocaleString([],{dateStyle:'medium',timeStyle:'short'}):'—';
let db=null,root=null,auth=null,migrated=false,students={},questions={},sessions={},classes={};
if(window.FIREBASE_READY&&window.firebase){try{firebase.initializeApp(window.FIREBASE_CONFIG);db=firebase.database();root=db.ref();}catch(e){console.error(e);}}
const ref=p=>root.child('mathQuiz/'+p);
const DEF=['Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JSS 1','JSS 2','JSS 3','SS 1','SS 2','SS 3'];
const slug=n=>'c_'+String(n).toLowerCase().replace(/[^a-z0-9]+/g,''),classOrder=n=>{const i=DEF.indexOf(n);return i<0?99:i;};
const idByName=n=>{const f=Object.entries(classes).find(([,c])=>String(c.name).toLowerCase()===String(n||'').trim().toLowerCase());return f?f[0]:'';};
const clsList=()=>Object.entries(classes).sort((a,b)=>(a[1].order||0)-(b[1].order||0)||String(a[1].name).localeCompare(String(b[1].name),undefined,{numeric:true}));
function fillCls(el,ph){const cur=el.value;el.innerHTML='<option value="">'+(ph||'Select class…')+'</option>'+clsList().map(([k,c])=>`<option value="${esc(k)}">${esc(c.name)}</option>`).join('');if(classes[cur])el.value=cur;}
function toast(t){const el=$('toast');el.textContent=t;el.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.add('hidden'),3800);}
const dbErr=e=>e&&e.code==='PERMISSION_DENIED'?'Firebase rules blocked this action.':'Check your connection and try again.';
function tab(t){document.querySelectorAll('.mq-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));['classes','students','questions','results'].forEach(n=>$('tab-'+n).classList.toggle('hidden',n!==t));}
document.querySelectorAll('.mq-tab').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
$('seedBtn').textContent=`Load starter bank (${(window.MQ_SEED||[]).length} questions)`;

/* ---------- live data ---------- */
const subs=[];let ready={};
function stopData(){subs.splice(0).forEach(f=>{try{f();}catch(e){}});ready={};migrated=false;students={};questions={};classes={};sessions={};}
function denied(){toast('Firebase rules blocked reading the data. Publish the database.rules.json provided.');}
function listen(name,q,set){const fn=s=>{set(s.val()||{});ready[name]=true;if(!migrated&&ready.students&&ready.questions&&ready.classes){migrated=true;migrate();}renderAll();};q.on('value',fn,e=>{console.error(e);if(e&&e.code==='PERMISSION_DENIED')return denied();toast('Could not read '+name+'. '+dbErr(e));});subs.push(()=>q.off('value',fn));}
function startData(){stopData();listen('students',ref('students'),v=>students=v);listen('questions',ref('questions'),v=>questions=v);listen('classes',ref('classes'),v=>classes=v);listen('sessions',ref('sessions').orderByChild('completedAt').limitToLast(500),v=>sessions=v);}
if(!db)toast('Firebase is not configured. Update firebase-config.js.');else startData();

function renderAll(){
 const ss=Object.entries(sessions),avg=ss.length?Math.round(ss.reduce((a,[,s])=>a+(Number(s.score)||0),0)/ss.length):null;
 $('aStudents').textContent=Object.keys(students).length;$('aQuestions').textContent=Object.keys(questions).length;$('aSessions').textContent=ss.length;$('aAvg').textContent=avg===null?'—':avg+'%';
 // students
 const sq=$('sSearch').value.toLowerCase();
 const fs=Object.entries(students).filter(([,s])=>`${s.name||''} ${s.className||''} ${s.passcode||''}`.toLowerCase().includes(sq));
 $('studentsTable').innerHTML=fs.length?fs.map(([k,s])=>`<tr><td><b>${esc(s.name)}</b><br><small>${s.active===false?'Inactive':'Active'}</small></td><td>${esc(s.passcode)}</td><td>${esc(s.className||'—')}</td><td><div class="mq-acts"><button class="btn" data-es="${esc(k)}">Edit</button><button class="btn" data-ts="${esc(k)}">${s.active===false?'Activate':'Deactivate'}</button><button class="btn danger" data-ds="${esc(k)}">Delete</button></div></td></tr>`).join(''):'<tr><td colspan="4">No students yet.</td></tr>';
 // questions
 const topics=[...new Set(Object.values(questions).map(q=>q.topic||'General'))].sort(),levels=[...new Set(Object.values(questions).map(q=>q.level).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 $('topicList').innerHTML=topics.map(t=>`<option value="${esc(t)}">`).join('');$('classesTable').innerHTML=clsList().length?clsList().map(([k,c])=>{const ns=Object.values(students).filter(s=>s.classId===k||(!s.classId&&s.className===c.name)).length,nq=Object.values(questions).filter(q=>qIds(q).includes(k)).length;return `<tr><td><b>${esc(c.name)}</b></td><td>${ns}</td><td>${nq}</td><td><div class="mq-acts"><button class="btn danger" data-dc="${esc(k)}">Delete</button></div></td></tr>`;}).join(''):'<tr><td colspan="4">No classes yet. Add one above or use the default set.</td></tr>';fillCls($('sClass'));fillQc();fillCls($('bulkClass'));fillCls($('xlsClass'),'Class column in file');fillCls($('qClsFilter'),'All classes');fillStu($('qStudents'));fillStu($('bulkStudent'),'Choose student…');
 const cur=$('qFilter').value;$('qFilter').innerHTML='<option value="">All topics</option>'+topics.map(t=>`<option>${esc(t)}</option>`).join('');if(topics.includes(cur))$('qFilter').value=cur;
 const qq=$('qSearch').value.toLowerCase(),qf=$('qFilter').value;
 const cf=$('qClsFilter').value;const fq=Object.entries(questions).filter(([,q])=>(!qf||(q.topic||'General')===qf)&&(!cf||qIds(q).includes(cf))&&`${q.topic||''} ${q.level||''} ${q.text||''}`.toLowerCase().includes(qq)).sort((a,b)=>(a[1].topic||'').localeCompare(b[1].topic||'')||(a[1].level||'').localeCompare(b[1].level||'',undefined,{numeric:true}));
 const cap=window.__qcap||50;window.__fq=fq.map(x=>x[0]);
 $('questionsTable').innerHTML=fq.length?fq.slice(0,cap).map(([k,q])=>`<tr><td><input type="checkbox" data-sq="${esc(k)}" ${SEL.has(k)?'checked':''}></td><td>${esc(q.topic||'General')}</td><td>${assignedTxt(q)}</td><td>${fmt(q.text)}</td><td>${LET[q.answer]||'?'}. ${fmt((q.options||[])[q.answer]||'')}</td><td>${esc(q.status||'published')}</td><td><div class="mq-acts"><button class="btn" data-eq="${esc(k)}">Edit</button><button class="btn danger" data-dq="${esc(k)}">Delete</button></div></td></tr>`).join('')+(fq.length>cap?`<tr><td colspan="7"><button class="btn" id="moreQ">Show more (${fq.length-cap} left)</button></td></tr>`:''):'<tr><td colspan="7">No questions match. Add one above or load the starter bank.</td></tr>';
 // results
 const rq=$('rSearch').value.toLowerCase();
 const fr=ss.filter(([,s])=>`${s.studentName||''} ${s.title||''}`.toLowerCase().includes(rq)).sort((a,b)=>(b[1].completedAt||0)-(a[1].completedAt||0));
 $('resultsTable').innerHTML=fr.length?fr.slice(0,200).map(([,s])=>`<tr><td>${when(s.completedAt)}</td><td>${esc(s.studentName)}</td><td>${esc(s.title)}</td><td><b>${Math.round(s.score||0)}%</b></td><td>${s.correct||0}/${s.total||0}</td><td>${Math.floor((s.durationSeconds||0)/60)}m ${(s.durationSeconds||0)%60}s</td></tr>`).join(''):'<tr><td colspan="6">No quizzes completed yet.</td></tr>';
 bind();
}
function bind(){
 document.querySelectorAll('[data-es]').forEach(b=>b.onclick=()=>editStudent(b.dataset.es));
 document.querySelectorAll('[data-ts]').forEach(b=>b.onclick=async()=>{const s=students[b.dataset.ts];try{await ref('students/'+b.dataset.ts+'/active').set(s.active===false);toast('Student status updated.');}catch(e){toast('Update failed. '+dbErr(e));}});
 document.querySelectorAll('[data-ds]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this student? Past results remain.'))return;const sid=b.dataset.ds,up={};up['mathQuiz/students/'+sid]=null;up['mathQuiz/assignments/'+sid]=null;Object.entries(questions).forEach(([k,q])=>{if(q&&q.studentIds&&q.studentIds[sid])up['mathQuiz/questions/'+k+'/studentIds/'+sid]=null;});try{await root.update(up);toast('Student deleted.');}catch(e){toast('Delete failed. '+dbErr(e));}});
 document.querySelectorAll('[data-eq]').forEach(b=>b.onclick=()=>editQuestion(b.dataset.eq));
 document.querySelectorAll('[data-dq]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this question?'))return;const k=b.dataset.dq,up={};up['mathQuiz/questions/'+k]=null;Object.keys((questions[k]||{}).studentIds||{}).forEach(s=>{up['mathQuiz/assignments/'+s+'/'+k]=null;});try{await root.update(up);if($('qId').value===k)clearQ();toast('Question deleted.');}catch(e){toast('Delete failed. '+dbErr(e));}});
 document.querySelectorAll('[data-dc]').forEach(b=>b.onclick=async()=>{const t=b.closest('tr').children;if(+t[1].textContent||+t[2].textContent)return toast('Move or delete this class’s students and questions first.');if(!confirm('Delete this class?'))return;try{await ref('classes/'+b.dataset.dc).remove();toast('Class deleted.');}catch(e){toast('Delete failed. '+dbErr(e));}});
 document.querySelectorAll('[data-sq]').forEach(c=>c.onchange=()=>{c.checked?SEL.add(c.dataset.sq):SEL.delete(c.dataset.sq);syncSel();});syncSel();
 const m=$('moreQ');if(m)m.onclick=()=>{window.__qcap=(window.__qcap||50)+50;renderAll();};
}
['sSearch','qSearch','rSearch'].forEach(i=>$(i).oninput=()=>{window.__qcap=50;renderAll();});$('qFilter').onchange=()=>{window.__qcap=50;renderAll();};

/* ---------- access helpers: classes and individual students ---------- */
function fillStu(el,ph){const cur=new Set([...el.selectedOptions].map(o=>o.value)),list=Object.entries(students).filter(([,s])=>s).sort((a,b)=>String(a[1].name).localeCompare(String(b[1].name)));el.innerHTML=(ph?'<option value="">'+esc(ph)+'</option>':'')+list.map(([k,s])=>`<option value="${esc(k)}">${esc(s.name)} (${esc(s.className||'no class')})</option>`).join('');[...el.options].forEach(o=>{if(o.value&&cur.has(o.value))o.selected=true;});}
function setStu(q){const ids=q.studentIds||{};[...$('qStudents').options].forEach(o=>{o.selected=!!ids[o.value];});}
function assignedTxt(q){const c=qIds(q).map(i=>classes[i]?classes[i].name:'?'),st=Object.keys(q.studentIds||{}).map(i=>students[i]?students[i].name:'?');return [c.length?esc(c.join(', ')):'',st.length?'👤 '+esc(st.join(', ')):''].filter(Boolean).join('<br>')||(q.demo?'<small>Free demo only</small>':'<small>Not assigned</small>');}
// keeps the per-student index (assignments/{studentId}/{questionId}) in step with questions[].studentIds
function assignPaths(up,qid,oldIds,newIds){oldIds.filter(x=>!newIds.includes(x)).forEach(s=>{up['mathQuiz/assignments/'+s+'/'+qid]=null;});newIds.forEach(s=>{up['mathQuiz/assignments/'+s+'/'+qid]=true;});}
// one-time upgrade of older records so the new access rules work (passcode lookup key, class ids)
function migrate(){const up={};let n=0;
 Object.entries(students).forEach(([k,s])=>{if(!s)return;const b='mathQuiz/students/'+k+'/',pk=String(s.passcode||'').trim().toLowerCase();if(pk&&s.passcodeKey!==pk){up[b+'passcodeKey']=pk;n++;}if(!s.classId){const c=idByName(s.className);if(c){up[b+'classId']=c;n++;}}});
 Object.entries(questions).forEach(([k,q])=>{if(!q||q.classId)return;const c=q.classIds?Object.keys(q.classIds)[0]:idByName(q.level);if(c){up['mathQuiz/questions/'+k+'/classId']=c;n++;}});
 if(n)root.update(up).then(()=>toast('Upgraded '+n+' older record(s) for the new access rules.')).catch(e=>{console.error(e);toast('Upgrade of older records failed. '+dbErr(e));});}
/* ---------- bulk assignment ---------- */
const SEL=new Set();
function qIds(q){if(q.classIds)return Object.keys(q.classIds);if(q.classId)return [q.classId];const f=idByName(q.level);return f?[f]:[];}
function fillQc(){fillCls($('qLevel'));fillCls($('baClass'));}
function syncSel(){const n=[...SEL].filter(k=>questions[k]).length,f=window.__fq||[];$('selCount').textContent=n;$('bulkBar').classList.toggle('hidden',!n);$('selAll').checked=!!f.length&&f.every(k=>SEL.has(k));}
function setIds(k,ids,up){up[k+'/classIds']=null;up[k+'/classId']=ids[0]||null;up[k+'/level']=ids[0]&&classes[ids[0]]?classes[ids[0]].name:'';up[k+'/updatedAt']=Date.now();}
async function bulk(fn,msg){const keys=[...SEL].filter(k=>questions[k]);if(!keys.length)return;const up={},ex={};keys.forEach(k=>fn(k,questions[k],up,ex));const full={...ex};Object.entries(up).forEach(([p,v])=>{full['mathQuiz/questions/'+p]=v;});try{await root.update(full);toast(`${msg}: ${keys.length} question(s).`);}catch(e){console.error(e);toast('Bulk update failed. '+dbErr(e));}}
$('selAll').onchange=e=>{(window.__fq||[]).forEach(k=>e.target.checked?SEL.add(k):SEL.delete(k));renderAll();};
const pickCls=()=>{const c=$('bulkClass').value;if(!c)toast('Choose a class in the bar first.');return c;};
$('bAdd').onclick=()=>{const c=pickCls();if(c)bulk((k,q,up)=>setIds(k,[c],up),'Moved to '+classes[c].name);};
$('bPub').onclick=()=>bulk((k,q,up)=>{up[k+'/status']='published';},'Published');
$('bDraft').onclick=()=>bulk((k,q,up)=>{up[k+'/status']='draft';},'Set to draft');
$('bDel').onclick=async()=>{if(!confirm('Delete all selected questions? This cannot be undone.'))return;await bulk((k,q,up,ex)=>{up[k]=null;Object.keys(q.studentIds||{}).forEach(s=>{ex['mathQuiz/assignments/'+s+'/'+k]=null;});},'Deleted');SEL.clear();};
const pickStu=()=>{const s=$('bulkStudent').value;if(!s)toast('Choose a student in the bar first.');return s;};
$('bSAdd').onclick=()=>{const s=pickStu();if(s)bulk((k,q,up,ex)=>{up[k+'/studentIds/'+s]=true;up[k+'/updatedAt']=Date.now();ex['mathQuiz/assignments/'+s+'/'+k]=true;},'Assigned to '+(students[s]?students[s].name:'student'));};
$('bSDel').onclick=()=>{const s=pickStu();if(s)bulk((k,q,up,ex)=>{up[k+'/studentIds/'+s]=null;up[k+'/updatedAt']=Date.now();ex['mathQuiz/assignments/'+s+'/'+k]=null;},'Removed student from');};
/* ---------- add many questions to one class ---------- */
function parseQs(txt){const ok=[],bad=[];String(txt).replace(/\r/g,'').split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean).forEach((b,i)=>{const raw=['','','',''],qs=[];let ans='',exp='';
 b.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{let m;if(m=l.match(/^([A-Da-d])[\).:]\s*(.+)$/))raw[LET.indexOf(m[1].toUpperCase())]=m[2].trim();else if(m=l.match(/^answer\s*[:=-]\s*(.+)$/i))ans=m[1].trim();else if(m=l.match(/^explanation\s*[:=-]\s*(.+)$/i))exp=m[1].trim();else if(!raw.some(Boolean)&&!ans)qs.push(l);});
 const li=LET.indexOf(ans.charAt(0).toUpperCase()),text=qs.join(' '),options=raw.filter(Boolean);
 if(!text||options.length<2||li<0||!raw[li])bad.push(i+1);else ok.push({text,options,answer:raw.slice(0,li).filter(Boolean).length,explanation:exp});});return {ok,bad};}
$('baText').oninput=()=>{const r=parseQs($('baText').value);$('baInfo').textContent=r.ok.length+' ready'+(r.bad.length?`, ${r.bad.length} need fixing (question ${r.bad.join(', ')})`:'');};
$('baSave').onclick=async()=>{if(!db)return toast('Configure Firebase first.');const c=$('baClass').value,topic=$('baTopic').value.trim();if(!classes[c])return toast('Choose the class first.');if(!topic)return toast('Enter the topic.');
 const r=parseQs($('baText').value);if(!r.ok.length)return toast('No complete questions found. Each needs options and an Answer line.');
 const up={};r.ok.forEach((q,i)=>{up[nid('q')+'_'+i]={topic,classId:c,level:classes[c].name,...q,status:'published',demo:false,createdAt:Date.now(),updatedAt:Date.now()};});
 try{await ref('questions').update(up);toast(`Saved ${r.ok.length} question(s) to ${classes[c].name}.`+(r.bad.length?` Skipped question ${r.bad.join(', ')} (incomplete).`:''));$('baText').value='';$('baInfo').textContent='0 ready';}catch(e){console.error(e);toast('Could not save. '+dbErr(e));}};
/* ---------- classes ---------- */
$('classForm').onsubmit=async e=>{e.preventDefault();if(!db)return toast('Configure Firebase first.');const name=$('cName').value.trim();if(!name)return;if(idByName(name)||classes[slug(name)])return toast('That class already exists.');try{await ref('classes/'+slug(name)).set({name,order:classOrder(name),createdAt:Date.now()});$('classForm').reset();toast('Class added.');}catch(err){toast('Could not add class. '+dbErr(err));}};
$('defClsBtn').onclick=async()=>{if(!db)return toast('Configure Firebase first.');const up={};DEF.forEach((n,i)=>{if(!idByName(n))up[slug(n)]={name:n,order:i,createdAt:Date.now()};});if(!Object.keys(up).length)return toast('Default classes already exist.');try{await ref('classes').update(up);toast('Default classes added.');}catch(e){toast('Could not add classes. '+dbErr(e));}};
/* ---------- students ---------- */
function banner(el,html,onCancel){el.innerHTML=html?`<span>${html}</span><button type="button" class="btn" style="padding:7px 13px">Cancel edit</button>`:'';el.classList.toggle('hidden',!html);if(html)el.querySelector('button').onclick=onCancel;}
function clearS(){$('studentForm').reset();$('studentId').value='';banner($('studentBanner'),'');$('sSubmit').textContent='Save student';}
function editStudent(k){const s=students[k];if(!s)return;tab('students');$('studentId').value=k;$('sName').value=s.name||'';$('sCode').value=s.passcode||'';$('sClass').value=s.classId&&classes[s.classId]?s.classId:idByName(s.className);$('sSubmit').textContent='Update student';banner($('studentBanner'),'Editing student: <b>'+esc(s.name)+'</b>',clearS);$('studentForm').scrollIntoView({behavior:'smooth',block:'start'});}
$('sClear').onclick=clearS;
$('studentForm').onsubmit=async e=>{e.preventDefault();if(!db)return toast('Configure Firebase first.');
 const key=$('studentId').value||nid('st'),code=$('sCode').value.trim(),name=$('sName').value.trim();if(!name||!code)return;
 if(code==='123123')return toast('123123 is reserved for the free demo. Choose another passcode.');
 if(Object.entries(students).some(([k,s])=>k!==key&&String(s.passcode).toLowerCase()===code.toLowerCase()))return toast('That passcode is already assigned. Choose another.');
 const cid=$('sClass').value;if(!classes[cid])return toast('Select the student’s class.');const old=students[key]||{};
 try{await ref('students/'+key).update({name,passcode:code,passcodeKey:code.toLowerCase(),classId:cid,className:classes[cid].name,active:old.active!==false,createdAt:old.createdAt||Date.now(),updatedAt:Date.now()});toast($('studentId').value?'Student updated.':'Student saved.');clearS();}catch(err){console.error(err);toast('Could not save student. '+dbErr(err));}};

/* ---------- questions ---------- */
function clearQ(){$('questionForm').reset();$('qId').value='';banner($('questionBanner'),'');$('qSubmit').textContent='Save question';}
function editQuestion(k){const q=questions[k];if(!q)return toast('Question not found. Reload the page.');tab('questions');const o=q.options||[];
 $('qId').value=k;$('qTopic').value=q.topic||'';$('qLevel').value=qIds(q)[0]||'';setStu(q);$('qDemo').checked=q.demo===true;$('qText').value=q.text||'';$('qA').value=o[0]||'';$('qB').value=o[1]||'';$('qC').value=o[2]||'';$('qD').value=o[3]||'';$('qAns').value=LET[q.answer]||'A';$('qStatus').value=q.status==='draft'?'draft':'published';$('qExp').value=q.explanation||'';
 $('qSubmit').textContent='Update question';banner($('questionBanner'),'Editing a question in <b>'+esc(q.topic||'General')+'</b>',clearQ);$('questionForm').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>$('qText').focus({preventScroll:true}),350);}
$('qClear').onclick=clearQ;
$('questionForm').onsubmit=async e=>{e.preventDefault();if(!db)return toast('Configure Firebase first.');
 const raw=[$('qA').value,$('qB').value,$('qC').value,$('qD').value].map(x=>x.trim()),letter=LET.indexOf($('qAns').value);
 if(!raw[letter])return toast('The correct answer points to an empty option.');
 const options=raw.filter(Boolean),answer=raw.slice(0,letter).filter(Boolean).length;
 if(new Set(options.map(x=>x.toLowerCase())).size!==options.length)return toast('Two options are identical. Make each option different.');
 const cid=$('qLevel').value,sids=[...$('qStudents').selectedOptions].map(o=>o.value).filter(x=>students[x]);if(!classes[cid]&&!sids.length)return toast('Choose a class, one or more students, or both.');
 const editing=!!$('qId').value,key=$('qId').value||nid('q');let old={};
 try{if(editing){const s=await ref('questions/'+key).once('value');if(!s.exists()){$('qId').value='';return toast('That question was deleted. Press Save to add it again.');}old=s.val()||{};}
  const up={};up['mathQuiz/questions/'+key]={topic:$('qTopic').value.trim()||'General',classId:classes[cid]?cid:null,level:classes[cid]?classes[cid].name:'',studentIds:sids.length?Object.fromEntries(sids.map(x=>[x,true])):null,demo:$('qDemo').checked,text:$('qText').value.trim(),options,answer,explanation:$('qExp').value.trim(),status:$('qStatus').value,createdAt:old.createdAt||Date.now(),updatedAt:Date.now()};assignPaths(up,key,Object.keys(old.studentIds||{}),sids);await root.update(up);
  toast(editing?'Question updated. Students see it straight away.':'Question saved.');clearQ();
 }catch(err){console.error(err);toast('Could not save question. '+dbErr(err));}};

$('seedBtn').onclick=async()=>{if(!db)return toast('Configure Firebase first.');const seed=window.MQ_SEED||[],up={},cu={};let added=0;const cidFor=n=>{const f=idByName(n);if(f)return f;const id=slug(n);cu[id]={name:n,order:classOrder(n),createdAt:Date.now()};return id;};
 seed.forEach((r,i)=>{const k='seed_'+String(i+1).padStart(3,'0');if(!questions[k]){up[k]={topic:r[0],level:r[1],classId:cidFor(r[1]),demo:i<5,text:r[2],options:r[3],answer:r[4],explanation:r[5],status:'published',createdAt:Date.now(),updatedAt:Date.now()};added++;}});
 if(!added)return toast('The starter bank is already loaded.');
 try{if(Object.keys(cu).length)await ref('classes').update(cu);await ref('questions').update(up);toast(`Added ${added} starter questions (first 5 are demo samples).`);}catch(e){console.error(e);toast('Could not add questions. '+dbErr(e));}};

$('demoBtn').onclick=async()=>{if(!db)return toast('Configure Firebase first.');const d=window.MQ_DEMO||[],up={};let n=0;
 d.forEach((r,i)=>{const k='demo_'+String(i+1).padStart(3,'0');if(!questions[k]){up[k]={topic:r[0],level:'Demo',demo:true,text:r[2],options:r[3],answer:r[4],explanation:r[5],status:'published',createdAt:Date.now(),updatedAt:Date.now()};n++;}});
 if(!n)return toast('The free demo questions are already loaded.');
 try{await ref('questions').update(up);toast('Added '+n+' free demo questions. Passcode 123123 will show them.');}catch(e){console.error(e);toast('Could not add questions. '+dbErr(e));}};

/* ---------- Excel ---------- */
$('tplBtn').onclick=()=>{if(!window.XLSX)return toast('Excel library did not load. Check your internet.');
 const H=['topic','class','question','A','B','C','D','answer','explanation','status','demo'];
 const ex=[['Algebra','JSS 2','Solve: 3x + 5 = 20','x = 3','x = 5','x = 6','x = 25/3','B','Subtract 5 from both sides to get 3x = 15, then divide by 3 to get x = 5.','published','no'],['Geometry','JSS 1','What is the sum of the angles in a triangle?','90°','180°','270°','360°','B','The three interior angles of any triangle add up to 180°.','published','no'],['Percentages','','What is 50% of 70?','25','30','35','40','C','50% is half, and half of 70 is 35.','published','yes']];
 const ws=XLSX.utils.aoa_to_sheet([H,...ex]);ws['!cols']=[18,12,50,16,16,16,16,9,60,11,8].map(w=>({wch:w}));
 const info=[['HOW TO FILL THE QUESTIONS SHEET'],[''],['topic','Required. e.g. Algebra. Give a topic 20 or more questions for a full topic quiz.'],['class','Required unless demo is yes, or pick a class in the import drop-down. New class names are created.'],['question','Required. Use ^ for powers, e.g. x^2.'],['A to D','At least two options. Leave C and D empty if not needed.'],['answer','Required. A to D, or 1 to 4, or the exact option text.'],['explanation','Strongly recommended. Students read it after every answer and the coach reads it aloud.'],['status','published or draft. Blank means published.'],['demo','yes adds the question to the free demo (passcode 123123). No class needed.'],[''],['Tip','One question per row. Delete the 3 sample rows first. A 40-question all-topics quiz needs 40 or more questions across the topics.']];
 const w2=XLSX.utils.aoa_to_sheet(info);w2['!cols']=[{wch:14},{wch:110}];
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Questions');XLSX.utils.book_append_sheet(wb,w2,'Instructions');XLSX.writeFile(wb,'math-quiz-question-template.xlsx');};
$('xlsFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(!db||!window.XLSX)return toast('Firebase or the Excel library is not ready.');
 try{const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}),target=$('xlsClass').value,up={},cu={},bad=[];let n=0;
  const cidOf=nm=>{nm=String(nm).trim();const x=idByName(nm);if(x)return x;const id=slug(nm);cu[id]={name:nm,order:classOrder(nm),createdAt:Date.now()};classes[id]=cu[id];return id;};
  wb.SheetNames.filter(sn=>!/^instructions$/i.test(sn)).forEach(sn=>XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}).forEach((r,i)=>{const L={};Object.entries(r).forEach(([k,v])=>L[String(k).trim().toLowerCase().replace(/[\s_-]+/g,'')]=v);
   if(!Object.values(L).some(v=>String(v).trim()))return;
   const text=String(L.question||L.text||'').trim(),raw=['a','b','c','d'].map(x=>String(L[x]??L['option'+x]??'').trim()),options=raw.filter(Boolean),a=String(L.answer??L.correct??'').trim(),where=sn+' row '+(i+2);
   let li=LET.indexOf(a.toUpperCase());if(li<0&&/^[1-4]$/.test(a))li=+a-1;if(li<0)li=raw.findIndex(x=>x&&x.toLowerCase()===a.toLowerCase());
   if(!text||options.length<2||li<0||!raw[li]){bad.push(where);return;}
   if(/^(y|yes|true|1)$/i.test(String(L.demo??'').trim())){up[nid('q')+'_'+n++]={topic:String(L.topic||'General').trim(),classId:'',level:'Demo',demo:true,text,options,answer:raw.slice(0,li).filter(Boolean).length,explanation:String(L.explanation||'').trim(),status:'published',createdAt:Date.now(),updatedAt:Date.now()};return;}
   let names=target?[]:String(L.class??L.classes??L.level??'').split(/[,;|]/).filter(s=>s.trim());
   if(!target&&!names.length){if(idByName(sn))names=[sn];else{bad.push(where+' (no class)');return;}}
   const ids=[...new Set(target?[target]:names.map(cidOf))].slice(0,1);
   up[nid('q')+'_'+n++]={topic:String(L.topic||'General').trim(),classId:ids[0],level:classes[ids[0]].name,demo:false,text,options,answer:raw.slice(0,li).filter(Boolean).length,explanation:String(L.explanation||'').trim(),status:String(L.status||'published').toLowerCase()==='draft'?'draft':'published',createdAt:Date.now(),updatedAt:Date.now()};}));
  if(!n)throw Error('No valid rows found.'+(bad.length?' Check '+bad.slice(0,3).join(', '):''));
  if(Object.keys(cu).length)await ref('classes').update(cu);await ref('questions').update(up);
  const nc=Object.values(cu).map(c=>c.name);
  toast(`Imported ${n} question(s).`+(bad.length?` Skipped ${bad.length}: ${bad.slice(0,3).join(', ')}${bad.length>3?'…':''}.`:'')+(nc.length?` New classes: ${nc.join(', ')}.`:''));
 }catch(err){console.error(err);toast('Import failed: '+err.message);}};

/* ---------- CSV ---------- */
$('exportBtn').onclick=()=>{const rows=Object.values(sessions).sort((a,b)=>(b.completedAt||0)-(a.completedAt||0)).map(s=>({date:when(s.completedAt),student:s.studentName,quiz:s.title,topic:s.topic,level:s.level,score:s.score,correct:s.correct,total:s.total,seconds:s.durationSeconds}));
 const head=['date','student','quiz','topic','level','score','correct','total','seconds'];
 const csv=[head.join(','),...rows.map(r=>head.map(h=>'"'+String(r[h]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));a.download='math-quiz-results.csv';a.click();URL.revokeObjectURL(a.href);};
})();
