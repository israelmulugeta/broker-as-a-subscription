document.getElementById('year').textContent = new Date().getFullYear();

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

const form = document.getElementById('subscribe-form');
const responseEl = document.getElementById('response');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  responseEl.textContent = 'Submitting...';

  const payload = {
    name: form.name.value,
    email: form.email.value
  };

  try {
    const response = await fetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    responseEl.textContent = response.ok ? data.message : data.error || 'Subscription failed';
  } catch (error) {
    responseEl.textContent = `Error: ${error.message}`;
  }
});
