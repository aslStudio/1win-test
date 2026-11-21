const toast = document.querySelector('[data-copy-toast]');
let toastTimer;

for (const button of document.querySelectorAll('[data-copy-promo]')) {
  button.addEventListener('click', async () => {
    const card = button.closest('.promo-code');
    const code = card?.querySelector('code');
    const label = button.querySelector('[data-copy-label]');
    if (!code || !toast || !label) return;

    let copied = false;
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      copied = true;
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    toast.textContent = copied ? 'Promo code copied' : 'Code selected. Copy it with your keyboard.';
    toast.classList.toggle('copy-toast--fallback', !copied);
    toast.classList.add('copy-toast--visible');
    label.textContent = copied ? 'Copied' : 'Copy code';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('copy-toast--visible');
      label.textContent = 'Copy code';
    }, 3000);
  });
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
for (const summary of document.querySelectorAll('.faq-item summary')) {
  summary.addEventListener('click', (event) => {
    if (reducedMotion.matches) return;
    event.preventDefault();
    const details = summary.parentElement;
    for (const animation of details.getAnimations()) animation.finish();
    const closing = details.open;
    const startHeight = details.getBoundingClientRect().height;
    if (!closing) details.open = true;
    const endHeight = closing ? summary.getBoundingClientRect().height : details.scrollHeight;
    details.style.overflow = 'hidden';
    const animation = details.animate(
      [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
      { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' },
    );
    animation.onfinish = () => {
      if (closing) details.open = false;
      details.style.overflow = '';
    };
    animation.oncancel = () => {
      details.style.overflow = '';
    };
  });
}
