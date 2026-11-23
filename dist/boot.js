// Runs before the module graph; blocked imports never leave the reader obscured without recourse.
(()=>{
  const panel=document.getElementById('folio-boot'),copy=panel.querySelector('[role=status]'),retry=panel.querySelector('button');
  function fail(){copy.textContent='Открытие занимает больше времени, чем обычно.';retry.hidden=false}
  const timer=setTimeout(fail,8000);
  retry.onclick=()=>location.reload();
  window.addEventListener('folio:ready',()=>{clearTimeout(timer);panel.remove()},{once:true});
})();
