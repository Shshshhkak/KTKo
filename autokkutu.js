/**
 * AutoKkutu.js - 단순 배열 DB 지원 통합 버전
 * * 사용법:
 * 1. DB_URL에 단어 리스트가 담긴 JSON 주소를 넣으세요.
 * 2. JSON 형식은 ["사과", "기차", ...] 또는 기존 인덱스 형식 모두 지원합니다.
 */

(function () {
    'use strict';

    // ============================================================
    // 설정
    // ============================================================
    const CONFIG = {
        DB_URL: 'https://raw.githubusercontent.com/Shshshhkak/KTKo/refs/heads/main/words_full.json',
        START_DELAY_MIN: 400,
        START_DELAY_MAX: 900,
        SUBMIT_DELAY_MIN: 150,
        SUBMIT_DELAY_MAX: 350,
        POLL_INTERVAL: 300,
        USE_WS_HOOK: true,
        AUTO_START: false,
    };

    const HANGUL_START = 0xAC00;
    const HANGUL_END = 0xD7A3;

    const INITIAL_LAW_MAP = {
        '라': '나', '락': '낙', '란': '난', '랄': '날', '람': '남', '랍': '납', '랑': '낭',
        '래': '내', '랭': '냉', '략': '약', '량': '양', '려': '여', '력': '역',
        '련': '연', '렬': '열', '렴': '염', '렵': '엽', '령': '영', '례': '예',
        '로': '노', '록': '녹', '론': '논', '롱': '농', '뢰': '뇌', '료': '요',
        '룡': '용', '루': '누', '류': '유', '륙': '육', '륜': '윤', '률': '율',
        '륭': '융', '름': '늠', '릉': '능', '리': '이', '린': '인', '림': '임', '립': '입',
        '냐': '야', '냑': '약', '냥': '양', '녀': '여', '녁': '역', '년': '연',
        '녈': '열', '념': '염', '녕': '영', '녜': '예', '뇨': '요', '뉴': '유',
        '뉵': '육', '니': '이',
    };

    const INITIAL_LAW_REVERSE = {};
    for (const [orig, law] of Object.entries(INITIAL_LAW_MAP)) {
        if (!INITIAL_LAW_REVERSE[law]) INITIAL_LAW_REVERSE[law] = [];
        INITIAL_LAW_REVERSE[law].push(orig);
    }

    function reverseInitialLaw(char) {
        return INITIAL_LAW_REVERSE[char] || [];
    }

    // ============================================================
    // 단어 DB (단순 배열 및 객체 구조 통합 지원)
    // ============================================================
    const DB = {
        laf: {}, fal: {}, kkutu: {}, kkt: {},
        loaded: false,

        async load(url) {
            console.log(`%c[AutoKkutu] DB 로딩 시작: ${url}`, 'color:#4fc3f7');
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                if (Array.isArray(data)) {
                    console.log('%c[AutoKkutu] 배열 형식을 감지하여 인덱싱을 수행합니다...', 'color:#ffb74d');
                    this.indexArray(data);
                } else {
                    this.laf = data.laf || {};
                    this.fal = data.fal || {};
                    this.kkutu = data.kkutu || {};
                    this.kkt = data.kkt || {};
                }

                this.loaded = true;
                const count = Object.values(this.laf).reduce((a, b) => a + b.length, 0);
                console.log(`%c[AutoKkutu] DB 로딩 완료! (${count.toLocaleString()}개 단어)`, 'color:#81c784');
                return true;
            } catch (e) {
                console.error('[AutoKkutu] DB 로딩 실패:', e);
                return false;
            }
        },

        indexArray(wordArray) {
            this.laf = {}; this.fal = {}; this.kkutu = {}; this.kkt = {};
            wordArray.forEach(word => {
                if (!word || word.length < 2) return;
                const w = word.trim();
                const first = w[0];
                const last = w[w.length - 1];
                
                if (!this.laf[first]) this.laf[first] = [];
                this.laf[first].push(w);

                if (!this.fal[last]) this.fal[last] = [];
                this.fal[last].push(w);

                if (w.length >= 2) {
                    const firstTwo = w.substring(0, 2);
                    if (!this.kkutu[firstTwo]) this.kkutu[firstTwo] = [];
                    this.kkutu[firstTwo].push(w);
                }

                if (w.length === 2 || w.length === 3) {
                    if (!this.kkt[first]) this.kkt[first] = { '2': [], '3': [] };
                    this.kkt[first][String(w.length)].push(w);
                }
            });
        },

        findWords(mode, condition, usedWords = new Set(), kktLen = 3) {
            if (!this.loaded || !condition) return [];
            let candidates = [];

            if (mode === 'laf' || mode === 'hunmin') {
                candidates = [...(this.laf[condition] || [])];
                for (const orig of reverseInitialLaw(condition)) {
                    candidates.push(...(this.laf[orig] || []));
                }
            } else if (mode === 'fal') {
                candidates = [...(this.fal[condition] || [])];
                for (const orig of reverseInitialLaw(condition)) {
                    candidates.push(...(this.fal[orig] || []));
                }
            } else if (mode === 'kkutu') {
                candidates = [...(this.kkutu[condition] || [])];
            } else if (mode === 'kkt') {
                const byLen = this.kkt[condition] || { '2': [], '3': [] };
                candidates = [...(byLen[String(kktLen)] || [])];
                for (const orig of reverseInitialLaw(condition)) {
                    const byLenOrig = this.kkt[orig] || { '2': [], '3': [] };
                    candidates.push(...(byLenOrig[String(kktLen)] || []));
                }
            } else if (mode === 'free') {
                candidates = Object.values(this.laf).flat().slice(0, 300);
            }

            return [...new Set(candidates)].filter(w => !usedWords.has(w));
        },

        selectBestWord(words, strategy = 'longest') {
            if (!words || words.length === 0) return null;
            if (strategy === 'longest') words.sort((a, b) => b.length - a.length);
            else if (strategy === 'shortest') words.sort((a, b) => a.length - b.length);
            else words.sort(() => Math.random() - 0.5);
            return words[0];
        }
    };

    // ============================================================
    // 시스템 로직 (우회, 후킹, 타이핑 등)
    // ============================================================
    const DOM = {
        getChatBox() {
            return Array.from(document.querySelectorAll('#Middle > div.ChatBox.Product > div.product-body > input'))
                .find(e => window.getComputedStyle(e).display !== 'none') || null;
        },
        getSubmitBtn() {
            return Array.from(document.querySelectorAll('#Middle > div.ChatBox.Product > div.product-body > button'))
                .find(e => window.getComputedStyle(e).display !== 'none') || null;
        },
        getCondition() {
            const el = document.querySelector('.jjo-display.ellipse');
            if (!el) return '';
            let text = el.textContent.trim().replace(/[<>]/g, '');
            return text.includes('(') ? text.substring(0, text.indexOf('(')) : text;
        },
        getMyName() { return document.querySelector('.my-stat-name')?.textContent?.trim() || null; },
        getCurrentTurnUserName() { return document.querySelector('.game-user-current .game-user-name')?.textContent?.trim() || null; },
        getWordHistory() {
            return Array.from(document.querySelectorAll('.ellipse.history-item.expl-mother'))
                .map(el => el.childNodes[0]?.textContent?.trim()).filter(Boolean);
        },
        getGameModeText() { return document.querySelector('.room-head-mode')?.textContent?.trim() || ''; }
    };

    const Typer = {
        async type(word, startDelay = 0, submitDelay = 200) {
            await new Promise(r => setTimeout(r, startDelay));
            const chatBox = DOM.getChatBox();
            const submitBtn = DOM.getSubmitBtn();
            if (!chatBox || !submitBtn) return false;

            chatBox.value = word;
            chatBox.dispatchEvent(new Event('input', { bubbles: true }));
            
            for (let i = 0; i < word.length; i++) {
                const ev = new KeyboardEvent('keyup', { bubbles: true, keyCode: 65 });
                chatBox.dispatchEvent(ev);
                const here = document.querySelector('.game-input');
                if (here) here.dispatchEvent(ev);
            }

            await new Promise(r => setTimeout(r, submitDelay));
            if (!GameState.myTurn) return false;
            submitBtn.click();
            GameState.lastEnteredWord = word;
            return true;
        }
    };

    const GameState = {
        mode: 'laf', condition: '', myTurn: false, usedWords: new Set(),
        kktLen: 3, myUserId: null, gameSeq: [], gaming: false, lastEnteredWord: ''
    };

    // WebSocket 후킹 및 자동화 루프 생략된 핵심 로직 유지
    let pollTimer = null;
    let isProcessingTurn = false;

    function poll() {
        if (!App.running) return;
        DOM.getWordHistory().forEach(w => GameState.usedWords.add(w));
        
        const isMyTurnNow = DOM.getMyName() && DOM.getCurrentTurnUserName() && DOM.getMyName() === DOM.getCurrentTurnUserName();
        const condition = DOM.getCondition();

        if (isMyTurnNow && !GameState.myTurn && condition) {
            GameState.myTurn = true;
            GameState.condition = condition;
            (async () => {
                if (isProcessingTurn) return;
                isProcessingTurn = true;
                const candidates = DB.findWords(GameState.mode, condition, GameState.usedWords);
                const best = DB.selectBestWord(candidates, App.settings.wordStrategy);
                if (best) {
                    await Typer.type(best, 
                        Math.floor(Math.random() * (CONFIG.START_DELAY_MAX - CONFIG.START_DELAY_MIN)) + CONFIG.START_DELAY_MIN,
                        Math.floor(Math.random() * (CONFIG.SUBMIT_DELAY_MAX - CONFIG.SUBMIT_DELAY_MIN)) + CONFIG.SUBMIT_DELAY_MIN
                    );
                }
                isProcessingTurn = false;
            })();
        } else if (!isMyTurnNow) {
            GameState.myTurn = false;
        }
    }

    // ============================================================
    // GUI 및 앱 초기화
    // ============================================================
    const App = {
        running: false,
        settings: { wordStrategy: 'longest' },
        async init() {
            if (window.axios) {
                window.axios.interceptors.request.use(r => r.url === '/o/c' ? Promise.reject('blocked') : r);
            }
            await DB.load(CONFIG.DB_URL);
            this.createGUI();
            console.log('%c[AutoKkutu] 초기화 완료', 'color:#81c784; font-weight:bold;');
        },
        start() {
            this.running = true;
            pollTimer = setInterval(poll, CONFIG.POLL_INTERVAL);
            document.getElementById('ak-status').textContent = '실행 중';
            document.getElementById('ak-status').style.color = '#66bb6a';
        },
        stop() {
            this.running = false;
            clearInterval(pollTimer);
            document.getElementById('ak-status').textContent = '정지됨';
            document.getElementById('ak-status').style.color = '#ef5350';
        },
        createGUI() {
            const div = document.createElement('div');
            div.style = 'position:fixed;top:10px;right:10px;z-index:9999;background:#121218;color:white;padding:15px;border-radius:10px;border:1px solid #333;font-family:sans-serif;font-size:12px;';
            div.innerHTML = `
                <div style="font-weight:bold;color:#4fc3f7;margin-bottom:10px;">⚡ AutoKkutu (Array 지원)</div>
                <div>상태: <span id="ak-status" style="color:#ef5350">정지됨</span></div>
                <div style="margin-top:10px;">
                    <button id="btn-start" style="background:#2e7d32;color:white;border:none;padding:5px 10px;cursor:pointer;">시작</button>
                    <button id="btn-stop" style="background:#c62828;color:white;border:none;padding:5px 10px;cursor:pointer;">정지</button>
                </div>
            `;
            document.body.appendChild(div);
            document.getElementById('btn-start').onclick = () => this.start();
            document.getElementById('btn-stop').onclick = () => this.stop();
        }
    };

    App.init();
    window.AutoKkutu = App;
})();
