// Optional Motion (the animation engine behind Framer Motion) enhancement.
// Content and navigation remain usable if this library fails to load.
(function (root) {
  'use strict';
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let active = [];
  function clear() {
    active.forEach(({control, element}) => {
      control.cancel();
      element.style.opacity = "1";
      element.style.transform = "none";
    });
    active = [];
  }
  function reveal(container) {
    clear();
    if (preference.matches || !root.Motion?.animate || !container) return;
    const elements = Array.from(container.children).filter(e => !e.hidden).slice(0, 10);
    elements.forEach((element, index) => {
      const control = root.Motion.animate(element, {opacity:[0,1],y:[14,0]}, {
        duration:0.48,delay:index*0.035,ease:[0.22,1,0.36,1]
      });
      active.push({control,element});
    });
  }
  preference.addEventListener('change', () => { if (preference.matches) clear(); });
  document.addEventListener('desk:view', e => reveal(document.getElementById('v-'+e.detail.view)));
  document.addEventListener('desk:chat', e => {
    if (preference.matches || !root.Motion?.animate || !e.detail.open) return;
    root.Motion.animate(document.getElementById('chat'),{opacity:[0,1],y:[16,0],scale:[0.98,1]},{type:'spring',stiffness:320,damping:30});
  });
  root.DeskBotMotion = Object.freeze({reveal});
})(globalThis);
