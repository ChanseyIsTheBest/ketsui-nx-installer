// Interface texts in English and Japanese. Works in the page and in the worker (no DOM here).
// Static texts in index.html name their key with data-i18n (plain text) or data-i18n-html (text with markup).

export const LANGUAGES = [
  { code: 'en', name: 'English', flag: 'uk' },
  { code: 'ja', name: '日本語', flag: 'japan' },
];

const SPHAIRA = '<a href="https://github.com/NaGaa95/sphaira/releases" target="_blank" rel="noopener">Sphaira</a>';

const TEXTS = {
  en: {
    legal:
      'Ketsui: Kizuna Jigoku Tachi is a game by CAVE; its Xbox 360 edition, Ketsui Kizuna Jigoku Tachi Extra, was published by 5pb. ketsui-nx is an unofficial fan project and is not affiliated with, endorsed or sponsored by CAVE, 5pb., Nintendo or Microsoft. Nintendo Switch is a trademark of Nintendo; Xbox 360 is a trademark of Microsoft. This site does not host or distribute game data or the original game executable: your disc image is read only inside your browser, is never uploaded, and its files are copied straight into the ketsui-nx.zip saved on your computer. You need your own legally obtained copy of the game.',
    sourceCode: 'Source code',
    signature: 'a ChanseyIsTheBest project',
    lead:
      'Builds the <strong>Nintendo Switch</strong> package of <strong>Ketsui: Kizuna Jigoku Tachi</strong> from your own ' +
      '<strong>Xbox 360</strong> disc. Everything runs in <strong>this browser</strong>.',
    languageBar: 'Language',
    step1: '1. Choose your game',
    formatPackage: 'Disc image',
    formatFolder: 'Folder',
    clear: 'Clear',
    ownCopy:
      '<strong>Important:</strong> you need your own copy of the game, dumped from your own disc. The installer reads the game from it to make the package; it supplies no game files of its own. Only the Japanese Xbox 360 disc, Ketsui Kizuna Jigoku Tachi Extra (title 465607D1), is supported.',
    formatHint:
      "<strong>Disc image:</strong> your game's <code>.iso</code> (a full disc dump, or an image rebuilt by extract-xiso). " +
      '<strong>Folder:</strong> a folder you extracted the game into (with <code>default.xex</code> and <code>Data/</code>).',
    nothingChosen: 'Nothing chosen yet.',
    chosenGame: 'Game: {name} ({size})',
    chosenNoGame: 'Game: not found yet',
    step2: '2. Create the package',
    step2First: 'If you are installing the game for the first time, use:',
    create: 'Create ketsui-nx.zip',
    step2Update:
      'If the game is already installed and you only want to update it (<code>ketsui.nro</code> and the shaders; the game is still needed to make the shaders), use:',
    createUpdate: 'Create ketsui-nx-update.zip',
    step3: '3. Copy it to the Switch',
    step3Extract: 'Extract the downloaded zip into <code>sdmc:/switch/</code>.',
    step3Start:
      'Start <code>ketsui.nro</code> from the Homebrew Menu in title takeover mode (<strong>launch</strong> a game installed on the Switch ' +
      `<strong>while holding R</strong>) or create a <strong>39-bit forwarder</strong> with ${SPHAIRA}. The album applet does not give the game enough memory.`,
    step3First:
      'The game writes its settings file, <code>ketsui.toml</code>, at its first start (button layout and controls for each player). The first time you play, it compiles the shader variants it has not seen yet, so the first minutes can stutter a little.',
    checking: 'Checking your game…',
    supported: 'Xbox 360 disc · supported',
    unsupported: 'This version of the game is not supported.',
    notGame: 'Not the game',
    noGame: 'The game was not found: choose its disc image, or a folder with default.xex.',
    gameDifferent: "the game's files are not the tested ones (missing, modified or damaged?); nothing was written",
    noStreaming: 'this browser window cannot stream downloads. Use a normal (not private) window.',
    downloadStarted: 'Download started ({size}). Keep this page open until it finishes.',
    finished: 'Finished in {seconds} s.',
    error: 'Error: {message}',
    cancelled: 'the download was cancelled',
    readingFiles: 'Reading your game',
    downloadingBuild: 'Downloading the Switch build',
    logBuild: 'Supported: Ketsui Kizuna Jigoku Tachi Extra for Xbox 360 (build {version})',
    logUpdate: 'Update package: ketsui.nro and the shaders',
    deko3dShaders: "Making the renderer's {count} shaders from the game's executable (about a minute)",
    deko3dReady: 'Shaders ready: they match the tested ones',
    packing: 'Writing the package',
    done: 'Done: extract the zip into sdmc:/switch/',
    notSupportedYet: 'this version of the game is not supported. Executable fingerprint: {hash}',
    buildMismatch: 'the downloaded {name} is not the published one ({hash}); try again later',
    deko3dContainers: "the game's shaders were not all found in its executable ({found} of {wanted}); nothing was written",
    deko3dMismatch: 'the shaders do not match the tested ones ({hash}); nothing was written',
    downloadFailed: 'could not download {url} ({status})',
  },
  ja: {
    legal:
      'ケツイ ～絆地獄たち～ は CAVE のゲームです。Xbox 360 版『ケツイ ～絆地獄たち～ EXTRA』は 5pb. から発売されました。ketsui-nx は非公式のファンプロジェクトであり、CAVE、5pb.、任天堂、Microsoft とは一切関係がなく、承認や後援も受けていません。Nintendo Switch は任天堂の商標です。Xbox 360 は Microsoft の商標です。このサイトはゲームデータや元のゲームの実行ファイルを配布していません。ディスクイメージはブラウザの中だけで読み込まれ、アップロードされることはなく、そのファイルはお使いのコンピューターに保存される ketsui-nx.zip に直接コピーされます。正規に入手したゲームが必要です。',
    sourceCode: 'ソースコード',
    signature: 'ChanseyIsTheBest のプロジェクト',
    lead:
      'お手持ちの <strong>Xbox 360</strong> 版ディスクから、<strong>ケツイ ～絆地獄たち～</strong> の ' +
      '<strong>Nintendo Switch</strong> 用パッケージを作成します。すべての処理は<strong>このブラウザの中</strong>で行われます。',
    languageBar: '言語',
    step1: '1. ゲームを選ぶ',
    formatPackage: 'ディスクイメージ',
    formatFolder: 'フォルダー',
    clear: 'クリア',
    ownCopy:
      '<strong>重要：</strong>ご自身のディスクから吸い出した、ご自身のゲームが必要です。インストーラーはそこからゲームを読み込んでパッケージを作成するだけで、ゲームファイルは一切提供しません。対応しているのは Xbox 360 版ディスク『ケツイ ～絆地獄たち～ EXTRA』（タイトル 465607D1）のみです。',
    formatHint:
      '<strong>ディスクイメージ：</strong>ゲームの <code>.iso</code>（ディスク全体の吸い出し、または extract-xiso で作り直したイメージ）。' +
      '<strong>フォルダー：</strong>ゲームを展開したフォルダー（<code>default.xex</code> と <code>Data/</code> を含むもの）。',
    nothingChosen: 'まだ何も選ばれていません。',
    chosenGame: 'ゲーム：{name}（{size}）',
    chosenNoGame: 'ゲーム：まだ見つかりません',
    step2: '2. パッケージを作成する',
    step2First: '初めてゲームをインストールする場合：',
    create: 'ketsui-nx.zip を作成',
    step2Update:
      'インストール済みで、更新（<code>ketsui.nro</code> とシェーダー）だけを行う場合（シェーダーの作成には引き続きゲームが必要です）：',
    createUpdate: 'ketsui-nx-update.zip を作成',
    step3: '3. Switch にコピーする',
    step3Extract: 'ダウンロードした zip を <code>sdmc:/switch/</code> に展開します。',
    step3Start:
      '<strong>タイトル乗っ取りモード</strong>の Homebrew Menu から <code>ketsui.nro</code> を起動するか（Switch にインストールされたゲームを <strong>R を押しながら起動</strong>）、' +
      `${SPHAIRA} で <strong>39 ビットのフォワーダー</strong>を作成します。アルバムアプレットではゲームに必要なメモリが足りません。`,
    step3First:
      'ゲームは初回起動時に設定ファイル <code>ketsui.toml</code>（ボタン配置と各プレイヤーの操作）を書き込みます。初めてプレイするときは、まだ使っていないシェーダーを準備するため、最初の数分は少しカクつくことがあります。',
    checking: 'ゲームを確認しています…',
    supported: 'Xbox 360 版ディスク · 対応',
    unsupported: 'このバージョンのゲームには対応していません。',
    notGame: 'ゲームではありません',
    noGame: 'ゲームが見つかりません。ディスクイメージ、または default.xex を含むフォルダーを選んでください。',
    gameDifferent: 'ゲームのファイルがテスト済みのものと異なります（不足、改変または破損？）。何も書き込まれていません',
    noStreaming: 'このブラウザウィンドウではダウンロードをストリーミングできません。通常の（プライベートではない）ウィンドウを使ってください。',
    downloadStarted: 'ダウンロードを開始しました（{size}）。完了するまでこのページを開いたままにしてください。',
    finished: '{seconds} 秒で完了しました。',
    error: 'エラー：{message}',
    cancelled: 'ダウンロードがキャンセルされました',
    readingFiles: 'ゲームを読み込んでいます',
    downloadingBuild: 'Switch 版をダウンロードしています',
    logBuild: '対応：Xbox 360 版『ケツイ ～絆地獄たち～ EXTRA』（ビルド {version}）',
    logUpdate: '更新パッケージ：ketsui.nro とシェーダー',
    deko3dShaders: 'ゲームの実行ファイルからレンダラーの {count} 個のシェーダーを作成しています（1 分ほどかかります）',
    deko3dReady: 'シェーダーの準備ができました（テスト済みのものと一致）',
    packing: 'パッケージを書き込んでいます',
    done: '完了：zip を sdmc:/switch/ に展開してください',
    notSupportedYet: 'このバージョンのゲームには対応していません。実行ファイルのフィンガープリント：{hash}',
    buildMismatch: 'ダウンロードした {name} が公開版と一致しません（{hash}）。しばらくしてからもう一度お試しください',
    deko3dContainers: 'ゲームのシェーダーが実行ファイルにすべて見つかりません（{wanted} 個中 {found} 個）。何も書き込まれていません',
    deko3dMismatch: 'シェーダーがテスト済みのものと一致しません（{hash}）。何も書き込まれていません',
    downloadFailed: '{url} をダウンロードできませんでした（{status}）',
  },
};

let current = 'en';

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  current = TEXTS[code] ? code : 'en';
  return current;
}

// The visitor's choice (saved in their browser), else the browser's language when it is one of ours, else English.
export function preferredLanguage(saved, browser = []) {
  if (saved && TEXTS[saved]) {
    return saved;
  }
  for (const tag of browser) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (TEXTS[code]) {
      return code;
    }
  }
  return 'en';
}

export function t(key, params = {}) {
  const text = TEXTS[current][key] ?? TEXTS.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? `{${name}}`));
}

// Sizes as Windows Explorer shows them, so the page and the file's properties agree: units of 1024 bytes (which
// Windows calls KB, MB and GB) and three significant digits, truncated. 7,834,892,288 bytes is 7.29 GB, not 7.83.
const SIZE_UNITS = {};

export function formatSize(bytes) {
  const units = SIZE_UNITS[current] ?? ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const scale = 10 ** decimals;
  // The small epsilon keeps values such as 7.3 from becoming 7.29 through floating point.
  const shown = Math.floor(value * scale + 1e-9) / scale;
  const number = new Intl.NumberFormat(current, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${number.format(shown)} ${units[unit]}`;
}
