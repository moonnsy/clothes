# Каталог → гардероб

Сайт-каталог открывается во вкладке «Каталог» гардероба (книжка в шапке). Если сайт
умеет «разговаривать» с гардеробом, его кнопки «скопировать» не кладут текст в буфер,
а отправляют его в гардероб. Там открывается окно: чей гардероб (персона или персонаж
чата), раздел (Outfit / Hairstyle / Accessories / Makeup) и название, и по «Add»
создаётся карточка с этим описанием.

Сайт без этих строк работает как раньше: просто копирует.

## Как это устроено

1. Когда сайт загрузился во вкладке, гардероб присылает ему
   `{ source: 'clothes-wardrobe', type: 'hello', version: 1 }`.
2. Сайт запоминает, откуда пришло «hello», и с этого момента на «скопировать» шлёт
   родительскому окну
   `{ source: 'outfit-catalog', type: 'add-to-wardrobe', text, title, categories }`.
   - `text` — описание (обязательно);
   - `title` — название карточки (можно пустое, тогда «Outfit 5» и т.п.);
   - `categories` — категории вещей сайта, по ним гардероб сам выбирает раздел:
     `hair` → Hairstyle, `makeup` → Makeup, `jewelry` / `accessory` / `bag` /
     `headwear` → Accessories, остальное и смесь → Outfit.
3. Гардероб принимает сообщения только от своей вкладки каталога.

## Что добавить в Outfit Lab (app.js)

```diff
@@ function renderItems() — кнопка «скопировать» на вещи
     cp.onclick = async e => {
       e.stopPropagation();
-      const ok = await copyText(it.prompt);
+      const name = it.sub && it.sub !== 'other' && it.label === catName(it.cat) ? subName(it.cat, it.sub) : it.label;
+      const sent = sendToWardrobe(it.prompt, name, [it.cat]);
+      const ok = sent || await copyText(it.prompt);
       cp.innerHTML = ok ? ICON_OK : ICON_FAIL;
       cp.classList.add('done');
       setTimeout(() => { cp.innerHTML = ICON_COPY; cp.classList.remove('done'); }, 1500);
-      toast(ok ? `Скопировано: ${it.label}` : 'Браузер не дал скопировать в буфер обмена');
+      toast(sent ? `В гардероб: ${name}` : ok ? `Скопировано: ${it.label}` : 'Браузер не дал скопировать в буфер обмена');
     };

@@ async function copyPrompt() — «Скопировать промпт» собранного образа
   const text = buildPrompt();
   if (!text) return;
-  const ok = await copyText(text);
+  const cats = SLOTS.flatMap(c => (S.outfit[c] || []).map(id => BY_ID[id].cat));
+  const sent = sendToWardrobe(text, '', cats);
+  const ok = sent || await copyText(text);
   setCreateBtn(ok ? 'ok' : 'fail');
   setTimeout(syncBar, 1800);
-  toast(ok ? `Промпт скопирован (${text.length} симв.)` : 'Браузер не дал скопировать в буфер обмена');
+  toast(sent ? 'Образ отправлен в гардероб' : ok ? `Промпт скопирован (${text.length} симв.)` : 'Браузер не дал скопировать в буфер обмена');
 }
+
+/* ---------- Гардероб SillyTavern ----------
+   Если сайт открыт во вкладке «Каталог» гардероба (расширение clothes), гардероб после загрузки присылает «hello».
+   Тогда «скопировать» не кладёт текст в буфер, а отправляет его в гардероб, и там сразу создаётся карточка.
+   Открытый сам по себе сайт ничего не получает и копирует как обычно. */
+let wardrobeOrigin = '';
+addEventListener('message', e => {
+  if (e.source === window.parent && window.parent !== window && e.data && e.data.source === 'clothes-wardrobe' && e.data.type === 'hello') wardrobeOrigin = e.origin;
+});
+function sendToWardrobe(text, title, categories) {
+  if (!wardrobeOrigin || !text) return false;
+  window.parent.postMessage({ source: 'outfit-catalog', type: 'add-to-wardrobe', text, title: title || '', categories: categories || [] }, wardrobeOrigin);
+  return true;
+}
```
