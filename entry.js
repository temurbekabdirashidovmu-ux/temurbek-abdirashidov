const form = document.getElementById('entry-form');
const password = form.elements.password;
const visibility = document.getElementById('show-password');
const message = document.getElementById('message');
const submit = form.querySelector('[type="submit"]');

visibility.checked = false;
visibility.closest('label').hidden = false;
visibility.addEventListener('change', () => {
  password.type = visibility.checked ? 'text' : 'password';
});
password.addEventListener('input', () => {
  if (password.hasAttribute('aria-invalid')) {
    password.removeAttribute('aria-invalid');
    message.textContent = '';
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  password.removeAttribute('aria-invalid');
  message.textContent = 'Tekshirilmoqda…';
  try {
    const response = await fetch('/api/entry-login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-portfolio-request': '1'},
      body: JSON.stringify({password: password.value})
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.ok) {
      location.reload();
      return;
    }
    message.textContent = result?.error || 'Sayt hozir javob bermayapti. Birozdan so‘ng qayta urinib ko‘ring.';
    if (response.status === 401) {
      password.setAttribute('aria-invalid', 'true');
      password.focus();
    }
  } catch {
    message.textContent = 'Saytga ulanib bo‘lmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.';
  }
  submit.disabled = false;
});
