(()=>{'use strict';
const $=id=>document.getElementById(id);
const cfg=window.FIREBASE_CONFIG;
let auth,db;
try{
 if(!window.firebase||!cfg) throw Error('Firebase configuration or SDK missing.');
 if(!firebase.apps.length) firebase.initializeApp(cfg);
 auth=firebase.auth(); db=firebase.database();
}catch(e){$('adminAuthMsg').textContent=e.message;return;}
const gate=$('adminAuthGate'),app=$('adminApp'),msg=$('adminAuthMsg');
let approved=false;
auth.onAuthStateChanged(async user=>{
 approved=false;app.style.display='none';gate.style.display='block';
 if(!user)return;
 try{
  const snap=await db.ref('access/admins/'+user.uid).once('value');
  if(snap.val()===true){approved=true;gate.style.display='none';app.style.display='block';}
  else {msg.textContent='This account is not an approved administrator. Sign out and use an approved account.';await auth.signOut();}
 }catch(e){msg.textContent='Could not verify administrator access. Check your Realtime Database rules. '+(e.message||'');}
});
$('adminAuthForm').addEventListener('submit',async e=>{
 e.preventDefault();msg.textContent='Signing in…';
 try{await auth.signInWithEmailAndPassword($('adminEmail').value.trim(),$('adminPassword').value);}
 catch(err){msg.textContent='Sign-in failed: '+(err.message||'Check email and password.');}
});
$('adminSignOut').onclick=()=>auth.signOut();
window.MQ_ADMIN_AUTH={get approved(){return approved;},auth,db};
})();