import { Translations } from '../types';

const ruTranslations: Translations = {
  'nodeActions.label': "Действия с узлом",
  'nodeActions.hasNote': "{topic}: есть заметка",
  'nodeActions.hasCards': "{topic}: есть карточки",
  'nodeActions.hasNoteAndCards': "{topic}: есть заметка и карточки",
  'notes.add': "Добавить заметку",
  'notes.open': "Открыть заметку",
  'notes.title': "Заметка узла",
  'notes.close': "Закрыть заметку",
  'notes.content': "Текст заметки",
  'anki.add': "Добавить карточку Anki",
  'anki.open': "Открыть карточки Anki",
  'anki.title': "Карточки Anki",
  'anki.close': "Закрыть карточки Anki",
  'anki.new': "Новая карточка",
  'anki.card': "Карточка",
  'anki.front': "Лицевая сторона",
  'anki.back': "Оборотная сторона",
  'anki.tags': "Метки",
  'anki.tagsPlaceholder': "Через пробел",
  'anki.deleteCard': "Удалить карточку {n}",
  'anki.deleted': "{card} удалена. Нажмите Ctrl/⌘+Z, чтобы отменить",
  'anki.empty': "У этого узла пока нет карточек",
  'anki.select': "Выбрать карточку",
  'anki.emptyFront': "(лицевая сторона пуста)",
  'anki.sides': "Стороны карточки",
  'anki.addImage': "Добавить изображение",
  'anki.imageHint': "Вставьте или перетащите изображения",
  'anki.image': "Изображение",
  'anki.removeImage': "Удалить изображение",
  'anki.previewImage': "Открыть изображение",
  'anki.closePreview': "Закрыть изображение",
  'anki.imageUnsupported': "Неподдерживаемый формат. Используйте PNG, JPEG, GIF или WebP",
  'anki.imageUnreadable': "Не удалось прочитать изображение",
  'anki.imageTooLarge': "Изображение слишком большое даже после сжатия. Обрежьте или уменьшите его",
  'anki.documentFull': "Изображение не добавлено: документ превысит лимит 8 МиБ (около {size})",
  'anki.documentLarge': "Документ большой (около {size}), близок к лимиту 8 МиБ",
  'anki.imagesAdding': "Обработка изображений…",
  'anki.imagesAdded': "Изображение добавлено",
  'anki.imageTargetGone': "Изображение не добавлено: карточка удалена",
  'anki.imageDocumentSwitched': "Изображение не добавлено: документ был заменён",
  'document.large': "Документ большой (около {size}), близок к лимиту 8 МиБ",
  'document.tooLarge': "Документ около {size}, больше лимита 8 МиБ, и может не сохраниться",
  'document.pasteRefused': "Не вставлено: документ стал бы около {size}, больше лимита 8 МиБ",
  'document.dismiss': "Закрыть",

  // Toolbar items
  'toolbar.hand': 'Рука — H',
  'toolbar.selection': 'Выделение — V',
  'toolbar.mind': 'Mind-карта — M',
  'toolbar.text': 'Текст — T',
  'toolbar.arrow': 'Стрелка — A',
  'toolbar.shape': 'Фигуры',
  'toolbar.image': 'Изображение — Cmd+U',
  'toolbar.extraTools': 'Дополнительно',

  'toolbar.pen': 'Карандаш — P',
  'toolbar.eraser': 'Ластик — E',

  'toolbar.arrow.straight': 'Прямая стрелка',
  'toolbar.arrow.elbow': 'Ломаная стрелка',
  'toolbar.arrow.curve': 'Кривая стрелка',

  'toolbar.shape.rectangle': 'Прямоугольник — R',
  'toolbar.shape.ellipse': 'Эллипс — O',
  'toolbar.shape.triangle': 'Треугольник',
  'toolbar.shape.terminal': 'Останов',
  'toolbar.shape.diamond': 'Ромб',
  'toolbar.shape.parallelogram': 'Параллелограмм',
  'toolbar.shape.roundRectangle': 'Скруглённый прямоугольник',

  // Zoom controls
  'zoom.in': 'Увеличить — Cmd++',
  'zoom.out': 'Уменьшить — Cmd+-',
  'zoom.fit': 'По размеру экрана',
  'zoom.100': 'Сбросить к 100%',
  
  // Themes
  'theme.default': 'Стандартная',
  'theme.colorful': 'Красочная',
  'theme.soft': 'Мягкая',
  'theme.retro': 'Старинная',
  'theme.dark': 'Тёмная',
  'theme.starry': 'Звёздная',

  // Colors
  'color.none': 'Автоматически',
  'color.unknown': 'Другой цвет',
  'color.default': 'Чёрный',
  'color.white': 'Белый',
  'color.gray': 'Серый',
  'color.deepBlue': 'Голубой',
  'color.red': 'Красный',
  'color.green': 'Зелёный',
  'color.yellow': 'Жёлтый',
  'color.purple': 'Фиолетовый',
  'color.orange': 'Оранжевый',
  'color.pastelPink': 'Розовый',
  'color.cyan': 'Лиловый',
  'color.brown': 'Коричневый',
  'color.forestGreen': 'Сосновный',
  'color.lightGray': 'Светло-серый',

  // General
  'general.undo': 'Отменить',
  'general.redo': 'Вернуть',
  'general.menu': 'Меню приложения',
  'general.duplicate': 'Дублировать',
  'general.delete': 'Удалить',
  
  // Language
  'language.switcher': 'Language',
  'language.chinese': '中文',
  'language.english': 'English',
  'language.russian': 'Русский',
  'language.arabic': 'عربي',
  'language.vietnamese': 'Tiếng Việt',
  
  // Menu items
  'menu.open': 'Открыть',
  'menu.saveFile': 'Сохранить',
  'menu.exportImage': 'Экспортировать',
  'menu.exportImage.svg': 'SVG',
  'menu.exportImage.png': 'PNG',
  'menu.exportImage.jpg': 'JPG',
  'menu.cleanBoard': 'Очистить доску',
  'menu.github': 'GitHub',
  
  // Dialog translations
  'dialog.mermaid.title': 'Mermaid в Drawnix',
  'dialog.mermaid.description': 'Поддерживаются',
  'dialog.mermaid.flowchart': 'блок-схемы',
  'dialog.mermaid.sequence': 'диаграммы последовательностей', 
  'dialog.mermaid.class': 'диаграммы классов',
  'dialog.mermaid.otherTypes':
    ' и другие диаграммы (преобразуются в изображения).',
  'dialog.mermaid.syntax': 'Синтаксис Mermaid',
  'dialog.mermaid.placeholder':
    'Введите сюда описание вашей Mermaid-диаграммы…',
  'dialog.mermaid.preview': 'Предпросмотр',
  'dialog.mermaid.insert': 'Вставить',
  'dialog.markdown.description':
    'Поддерживается автоматическое преобразование синтаксиса Markdown в mind-карты.',
  'dialog.markdown.syntax': 'Синтаксис Markdown',
  'dialog.markdown.placeholder':
    'Введите сюда описание вашего текста Markdown…',
  'dialog.markdown.preview': 'Предпросмотр',
  'dialog.markdown.insert': 'Вставить',
  'dialog.error.loadMermaid': 'Не удалось загрузить библотеку Mermaid',
  
  // Extra tools menu items
  'extraTools.mermaidToDrawnix': 'Mermaid в Drawnix',
  'extraTools.markdownToDrawnix': 'Markdown в Drawnix',

  // Clean confirm dialog
  'cleanConfirm.title': 'Очистить доску',
  'cleanConfirm.description':
    'Это удалит всё содержимое доски. Вы хотите продолжить?',
  'cleanConfirm.cancel': 'Отмена',
  'cleanConfirm.ok': 'ОК',

  // Link popup items
  'popupLink.delLink': 'Удалить ссылку',

  // Tool popup items
  'popupToolbar.fillColor': 'Цвет заливки',
  'popupToolbar.fontColor': 'Цвет текста',
  'popupToolbar.link': 'Вставить ссылку',
  'popupToolbar.stroke': 'Контур',
  'popupToolbar.opacity': 'Прозрачность',
  
  // Text placeholders
  'textPlaceholders.link': 'Ссылка',
  'textPlaceholders.text': 'Текст',

  // Line tool
  'line.source': 'Начало',
  'line.target': 'Конец',
  'line.arrow': 'Стрелка',
  'line.none': 'Нет',

  // Stroke style
  'stroke.solid': 'Сплошной',
  'stroke.dashed': 'Штриховой',
  'stroke.dotted': 'Пунктирный',

  //markdown example
  'markdown.example': `# I have started

  - Let me see who made this bug 🕵️ ♂️ 🔍
    - 😯 💣
      - Turns out it was me 👈 🎯 💘

  - Unexpectedly, it cannot run; why is that 🚫 ⚙️ ❓
    - Unexpectedly, it can run now; why is that? 🎢 ✨
      - 🤯 ⚡ ➡️ 🎉

  - What can run 🐞 🚀
    - then do not touch it 🛑 ✋
      - 👾 💥 🏹 🎯
    
  ## Boy or girl 👶 ❓ 🤷 ♂️ ♀️

  ### Hello world 👋 🌍 ✨ 💻

  #### Wow, a programmer 🤯 ⌨️ 💡 👩 💻`,

  // Draw elements text
  'draw.lineText': 'Текст',
  'draw.geometryText': 'Текст',
  
  // Mind map elements text
  'mind.centralText': 'Центральная тема',
  'mind.abstractNodeText': 'Резюме',
  
  'tutorial.title': 'Drawnix',
  'tutorial.description':
    'Универсальная доска: майнд-карты, блок-схемы, свободное рисование и многое другое',
  'tutorial.dataDescription': 'Все данные хранятся локально в вашем браузере',
  'tutorial.appToolbar': 'Экспорт, настройки языка, ...',
  'tutorial.creationToolbar': 'Выберите инструмент, чтобы начать творить',
  'tutorial.themeDescription': 'Переключение между светлой и тёмной темами',
};

export default ruTranslations;
