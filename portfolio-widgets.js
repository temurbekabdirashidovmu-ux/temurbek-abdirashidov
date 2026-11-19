(() => {
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function button(label) {
    const element = node('button', label, 'community-small');
    element.type = 'button';
    return element;
  }

  function selector(label, choices) {
    const select = node('select');
    select.setAttribute('aria-label', label);
    for (const [value, title] of choices) select.add(new Option(title, value));
    return select;
  }

  function fileURL(certificate, base) {
    return certificate.asset ? base + '/' + certificate.asset : base + '/api/files/' + certificate.id;
  }

  function searchable(value) {
    return String(value ?? '').toLocaleLowerCase('uz').replace(/[‘’ʻʼ`']/g, "'").trim();
  }

  function openViewer(images, index, base, opener) {
    const dialog = node('dialog', '', 'portfolio-lightbox certificate-viewer');
    if (!dialog.showModal) {
      window.open(fileURL(images[index], base), '_blank', 'noopener');
      return;
    }
    dialog.setAttribute('aria-label', 'Sertifikatni ko‘rish');
    const close = button('Yopish');
    const title = node('h2');
    const caption = node('p');
    const header = node('header', '', 'certificate-viewer-head');
    const info = node('div');
    info.setAttribute('aria-live', 'polite');
    info.append(title, caption);
    header.append(info, close);
    const image = node('img');
    const previous = button('Oldingi');
    const next = button('Keyingi');
    const original = node('a', 'Asl rasmni ochish');
    original.target = '_blank';
    original.rel = 'noopener';
    const actions = node('div', '', 'certificate-viewer-actions');
    actions.append(previous, next, original);
    dialog.append(header, image, actions);
    function show(position) {
      index = (position + images.length) % images.length;
      const cert = images[index];
      title.textContent = cert.title;
      caption.textContent = [cert.student, (index + 1) + ' / ' + images.length].filter(Boolean).join(' · ');
      image.alt = [cert.title, cert.student].filter(Boolean).join(' — ');
      image.src = original.href = fileURL(cert, base);
      previous.hidden = next.hidden = images.length < 2;
    }
    previous.onclick = () => show(index - 1);
    next.onclick = () => show(index + 1);
    close.onclick = () => dialog.close();
    dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + (event.key === 'ArrowLeft' ? -1 : 1));
      }
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => { dialog.remove(); opener.focus(); }, {once:true});
    show(index);
    document.body.append(dialog);
    dialog.showModal();
    close.focus();
  }

  function renderCertificates(container, certificates, {base = '', showStudent = false, students = []} = {}) {
    const profiles = new Map(students.map(student => [student.name, student.id || student.name]));
    const controls = node('div', '', 'portfolio-controls');
    const search = node('input');
    search.type = 'search';
    search.placeholder = 'Ism yoki hujjat nomi…';
    search.setAttribute('aria-label', 'Sertifikatlarni qidirish');
    const type = selector('Hujjat turi', [['', 'Barcha hujjatlar'], ['image/', 'Rasmlar'], ['application/pdf', 'PDF hujjatlar']]);
    const sort = selector('Sertifikatlarni saralash', [['original', 'Avvalgi tartib'], ['title', 'Nomi bo‘yicha'], ['student', 'O‘quvchi bo‘yicha']]);
    const clear = button('Filtrlarni tozalash');
    const result = node('p', '', 'community-meta');
    result.setAttribute('role', 'status');
    const grid = node('div', '', 'community-grid certificate-grid');
    controls.append(search, type, sort, clear);
    container.replaceChildren(controls, result, grid);

    function draw() {
      const terms = searchable(search.value).split(/\s+/).filter(Boolean);
      const list = certificates.filter(cert => {
        const text = searchable([cert.student, cert.title].join(' '));
        return (!type.value || String(cert.type).startsWith(type.value)) && terms.every(term => text.includes(term));
      });
      if (sort.value !== 'original') list.sort((a,b) => String(a[sort.value] || '').localeCompare(String(b[sort.value] || ''), 'uz'));
      const images = list.filter(cert => cert.type?.startsWith('image/'));
      clear.hidden = !search.value && !type.value && sort.value === 'original';
      result.textContent = list.length + ' ta hujjat · jami ' + certificates.length;
      grid.replaceChildren();
      for (const cert of list) {
        const card = node('article', '', 'community-card certificate-card');
        const src = fileURL(cert, base);
        if (cert.type?.startsWith('image/')) {
          const open = button('');
          open.className = 'portfolio-image-button';
          open.setAttribute('aria-label', [cert.title, cert.student, 'kattalashtirish'].filter(Boolean).join(' — '));
          const img = node('img', '', 'community-preview');
          img.src = src;
          img.alt = cert.title;
          img.loading = 'lazy';
          open.append(img);
          open.onclick = () => openViewer(images, images.indexOf(cert), base, open);
          card.append(open);
        } else card.append(node('span', 'PDF', 'community-badge'));
        if (showStudent) {
          const name = node('p', '', 'community-meta');
          if (profiles.has(cert.student)) {
            const profile = node('a', cert.student, 'certificate-profile');
            profile.href = base + '/student/' + encodeURIComponent(profiles.get(cert.student)) + '#sertifikatlar';
            name.append(profile);
          } else name.textContent = cert.student;
          card.append(name);
        }
        card.append(node('h3', cert.title));
        const link = node('a', 'Hujjatni ochish', 'btn');
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener';
        card.append(link);
        grid.append(card);
      }
      if (!list.length) grid.append(node('p', certificates.length ? 'Qidiruvga mos sertifikat topilmadi.' : 'Sertifikatlar hali qo‘shilmagan.', 'community-empty'));
    }
    clear.onclick = () => { search.value = type.value = ''; sort.value = 'original'; draw(); search.focus(); };
    search.oninput = type.onchange = sort.onchange = draw;
    draw();
  }
  window.PortfolioWidgets = {renderCertificates};
})();
