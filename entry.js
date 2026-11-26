const form = document.getElementById('entry-form');
const password = form.elements.password;
const visibility = document.getElementById('show-password');
const message = document.getElementById('message');
const submit = form.querySelector('[type="submit"]');
const originalLabel = submit.textContent;
visibility.checked = false;
visibility.closest('label').hidden = false;
visibility.addEventListener('change', () => {
  password.type = visibility.checked ? 'text' : 'password';
});
password.addEventListener('input', () => {
  if (submit.disabled) return;
  password.removeAttribute('aria-invalid');
  message.textContent = '';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled || !form.reportValidity()) return;
  submit.disabled = true;
  password.readOnly = true;
  form.setAttribute('aria-busy', 'true');
  submit.textContent = 'Kirilmoqda…';
  password.removeAttribute('aria-invalid');
  message.textContent = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  let authenticated = false;
  try {
    const response = await fetch('/api/entry-login', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'x-portfolio-request': '1'},
      body: JSON.stringify({password: password.value}),
      signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.ok === true) {
      authenticated = true;
      password.value = '';
      visibility.checked = false;
      password.type = 'password';
      if (location.pathname === '/') location.replace('/index.html');
      else location.reload();
      return;
    }
    message.textContent = result?.error || 'Kabinet hozir javob bermayapti. Qayta urinib ko‘ring.';
    if (response.status === 401) password.setAttribute('aria-invalid', 'true');
  } catch (error) {
    message.textContent = error.name === 'AbortError' ? 'Server uzoq javob bermadi. Qayta urinib ko‘ring.' : 'Saytga ulanib bo‘lmadi. Internet aloqasini tekshiring.';
  } finally {
    clearTimeout(timeout);
    if (!authenticated) {
      submit.disabled = false;
      password.readOnly = false;
      form.removeAttribute('aria-busy');
      submit.textContent = originalLabel;
      if (password.hasAttribute('aria-invalid')) { password.focus(); password.select(); }
    }
  }
});
