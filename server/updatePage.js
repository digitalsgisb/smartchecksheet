// /api/ navigations bypass old app-shell workers, so this also repairs old clients.
export const updatePage = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Update Production Digital</title>
<style>body{margin:0;background:#10161f;color:#f3f6fa;font:16px system-ui;min-height:100vh;display:grid;place-items:center}main{max-width:480px;padding:32px}h1{font-size:28px}p{line-height:1.6;color:#c5d3e5}button{background:#315f96;color:white;border:0;border-radius:8px;padding:16px 22px;font:inherit;cursor:pointer}button:disabled{opacity:.65}</style></head>
<body><main><h1>Update Production Digital</h1><p>Load the latest app version. Your login cookie, accounts and server records will be kept.</p><button id="update" type="button">Reload latest app</button><p id="status" role="status"></p></main>
<script>
document.getElementById('update').addEventListener('click',async function(){
  this.disabled=true;
  const status=document.getElementById('status');status.textContent='Updating…';
  try{
    const response=await fetch('/api/health',{cache:'no-store'});
    if(!response.ok)throw new Error('The server is unavailable. Try again when connected.');
    if('serviceWorker' in navigator){const registration=await navigator.serviceWorker.getRegistration();if(registration)await registration.unregister();}
    window.location.replace('/?app-update='+Date.now());
  }catch(error){status.textContent='Update could not finish. '+error.message;this.disabled=false;}
});
</script></body></html>`;
