/**
 * AutoKkutu.js - kkutu.co.kr 전용 자동 입력 스크립트
 * 
 * 사용법:
 *   F12 콘솔에서 아래 명령어 실행:
 *   fetch('https://raw.githubusercontent.com/YOUR_REPO/main/autokkutu.js').then(r=>r.text()).then(eval);
 * 
 * 기능:
 *   - 끝말잇기 / 앞말잇기 / 끄투 / 쿵쿵따 / 자유 / 타자대결 지원
 *   - WebSocket 후킹을 통한 빠른 턴 감지
 *   - kkutu.co.kr 안티치트 우회 (game_input, 가짜채팅창 감지 등)
 *   - GUI 설정 패널 (모드 변경, 딜레이 설정, 시작/정지)
 *   - axios /o/c 안티치트 패킷 차단
 * 
 * 주의사항:
 *   - 단어 DB JSON 파일을 GitHub에 올리고 DB_URL을 수정하세요.
 *   - 이 스크립트는 kkutu.co.kr 전용입니다.
 */

(function () {
    'use strict';

    // ============================================================
    // 설정 (DB URL은 GitHub에 업로드 후 수정)
    // ============================================================
    const CONFIG = {
        DB_URL: 'https://raw.githubusercontent.com/Shshshhkak/KTKo/refs/heads/main/words_full.json',
        // 시작 딜레이 (ms) - 너무 빠르면 감지될 수 있음
        START_DELAY_MIN: 400,
        START_DELAY_MAX: 900,
        // 전송 딜레이 (ms)
        SUBMIT_DELAY_MIN: 150,
        SUBMIT_DELAY_MAX: 350,
        // DOM 폴링 주기 (ms)
        POLL_INTERVAL: 300,
        // WebSocket 후킹 사용 여부
        USE_WS_HOOK: true,
        // 자동 시작 여부
        AUTO_START: false,
    };

    // ============================================================
    // 상수
    // ============================================================
    const HANGUL_START = 0xAC00;
    const HANGUL_END = 0xD7A3;

    // 두음법칙 매핑 (초성 기준)
    // 끝말잇기에서 '라'로 끝나는 단어 다음에 '나'로 시작하는 단어도 허용
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

    // 역방향 두음법칙 (두음법칙 적용된 글자 -> 원래 글자)
    const INITIAL_LAW_REVERSE = {};
    for (const [orig, law] of Object.entries(INITIAL_LAW_MAP)) {
        if (!INITIAL_LAW_REVERSE[law]) INITIAL_LAW_REVERSE[law] = [];
        INITIAL_LAW_REVERSE[law].push(orig);
    }

    // ============================================================
    // 한글 유틸리티
    // ============================================================
    function isHangul(char) {
        if (!char) return false;
        const code = char.charCodeAt(0);
        return code >= HANGUL_START && code <= HANGUL_END;
    }

    // 두음법칙 적용: 단어의 첫 글자에 두음법칙 적용 (ㄹ->ㄴ, ㄴ->ㅇ 등)
    function applyInitialLaw(char) {
        return INITIAL_LAW_MAP[char] || char;
    }

    // 두음법칙 역적용: 두음법칙 적용된 글자에서 원래 글자 목록 반환
    function reverseInitialLaw(char) {
        return INITIAL_LAW_REVERSE[char] || [];
    }

    // ============================================================
    // 단어 DB
    // ============================================================
    const DB = {
        laf: {},    // 끝말잇기: 첫 글자 -> 단어 배열
        fal: {},    // 앞말잇기: 마지막 글자 -> 단어 배열
        kkutu: {},  // 끄투: 첫 두 글자 -> 단어 배열
        kkt: {},    // 쿵쿵따: 첫 글자 -> { 2: [...], 3: [...] }
        loaded: false,

        async load(url) {
            console.log(`%c[AutoKkutu] DB 로딩 중... (${url})`, 'color:#4fc3f7');
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this.laf = data.laf || {};
                this.fal = data.fal || {};
                this.kkutu = data.kkutu || {};
                this.kkt = data.kkt || {};
                this.loaded = true;
                const totalWords = Object.values(this.laf).reduce((a, b) => a + b.length, 0);
                console.log(`%c[AutoKkutu] DB 로딩 완료! 총 ${totalWords.toLocaleString()}개 단어`, 'color:#81c784');
                return true;
            } catch (e) {
                console.error('[AutoKkutu] DB 로딩 실패:', e);
                return false;
            }
        },

        /**
         * 조건에 맞는 단어 목록 반환
         * @param {string} mode - 'laf'|'fal'|'kkutu'|'kkt'
         * @param {string} condition - 제시어 (예: '가', '가나')
         * @param {Set} usedWords - 이미 사용된 단어 집합
         * @param {number} kktLen - 쿵쿵따 글자 수 (2 또는 3)
         * @returns {string[]}
         */
        findWords(mode, condition, usedWords = new Set(), kktLen = 3) {
            if (!this.loaded || !condition) return [];

            let candidates = [];

            if (mode === 'laf') {
                // 끝말잇기: 제시어 첫 글자로 시작하는 단어
                candidates = [...(this.laf[condition] || [])];
                // 두음법칙 역적용: 예) 조건이 '이'이면 '리'로 시작하는 단어도 포함
                for (const orig of reverseInitialLaw(condition)) {
                    candidates.push(...(this.laf[orig] || []));
                }

            } else if (mode === 'fal') {
                // 앞말잇기: 제시어 마지막 글자로 끝나는 단어
                // fal 인덱스는 '마지막 글자' 기준
                candidates = [...(this.fal[condition] || [])];
                // 두음법칙 역적용
                for (const orig of reverseInitialLaw(condition)) {
                    candidates.push(...(this.fal[orig] || []));
                }

            } else if (mode === 'kkutu') {
                // 끄투: 제시어 첫 두 글자로 시작하는 단어
                candidates = [...(this.kkutu[condition] || [])];

            } else if (mode === 'kkt') {
                // 쿵쿵따: 제시어 첫 글자로 시작하는 kktLen 글자 단어
                const byLen = this.kkt[condition] || {};
                // kkt 인덱스 키는 문자열 '2' 또는 '3'
                candidates = [...(byLen[String(kktLen)] || [])];
                for (const orig of reverseInitialLaw(condition)) {
                    const byLenOrig = this.kkt[orig] || {};
                    candidates.push(...(byLenOrig[String(kktLen)] || []));
                }

            } else if (mode === 'free') {
                // 자유: 아무 단어나
                const allWords = Object.values(this.laf).flat();
                candidates = allWords.slice(0, 200); // 너무 많으면 성능 저하

            } else if (mode === 'typing') {
                // 타자대결: 제시된 단어 그대로 입력 (별도 처리)
                return [];
            }

            // 중복 제거 및 이미 사용된 단어 필터링
            return [...new Set(candidates)].filter(w => !usedWords.has(w));
        },

        /**
         * 단어 목록에서 최적의 단어 선택
         * @param {string[]} words
         * @param {string} strategy - 'longest'|'shortest'|'random'
         * @returns {string|null}
         */
        selectBestWord(words, strategy = 'longest') {
            if (!words || words.length === 0) return null;

            if (strategy === 'longest') {
                words.sort((a, b) => b.length - a.length);
            } else if (strategy === 'shortest') {
                words.sort((a, b) => a.length - b.length);
            } else {
                // random: 섞기
                for (let i = words.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [words[i], words[j]] = [words[j], words[i]];
                }
            }
            return words[0];
        }
    };

    // ============================================================
    // 안티치트 우회 (axios /o/c 차단)
    // ============================================================
    function setupAxiosInterceptor() {
        // DOMContentLoaded 이후 axios가 로드되면 인터셉터 등록
        const tryIntercept = () => {
            if (window.axios) {
                window.axios.interceptors.request.use(
                    req => {
                        // /o/c 안티치트 패킷 차단
                        if (req.url === '/o/c') {
                            console.warn('[AutoKkutu] 안티치트 패킷 차단:', req.data);
                            return Promise.reject(new Error('AutoKkutu: /o/c blocked'));
                        }
                        return req;
                    },
                    err => Promise.reject(err),
                    { synchronous: true }
                );
                console.log('%c[AutoKkutu] axios 인터셉터 등록 완료', 'color:#81c784');
            } else {
                // axios가 아직 로드되지 않았으면 잠시 후 재시도
                setTimeout(tryIntercept, 500);
            }
        };
        tryIntercept();
    }

    // ============================================================
    // WebSocket 후킹
    // ============================================================
    let wsHookActive = false;
    const _OriginalWS = window.WebSocket;

    function hookWebSocket(onMessage) {
        if (wsHookActive) return;
        wsHookActive = true;

        window.WebSocket = function (url, protocols) {
            const ws = protocols ? new _OriginalWS(url, protocols) : new _OriginalWS(url);

            // onmessage 프로퍼티 가로채기
            Object.defineProperty(ws, 'onmessage', {
                configurable: true,
                enumerable: true,
                set: function (userHandler) {
                    const wrappedHandler = function (event) {
                        try {
                            const data = JSON.parse(event.data);
                            onMessage(data);
                        } catch (_) {}
                        if (userHandler) userHandler.apply(this, arguments);
                    };
                    // 이전에 등록된 핸들러 제거 방지를 위해 addEventListener 사용
                    if (ws._akInjectedHandler) {
                        ws.removeEventListener('message', ws._akInjectedHandler, false);
                    }
                    ws._akInjectedHandler = wrappedHandler;
                    ws.addEventListener('message', wrappedHandler, false);
                }
            });

            // addEventListener도 가로채기
            const origAddEventListener = ws.addEventListener.bind(ws);
            ws.addEventListener = function (type, listener, options) {
                if (type === 'message') {
                    const wrappedListener = function (event) {
                        try {
                            const data = JSON.parse(event.data);
                            onMessage(data);
                        } catch (_) {}
                        listener.apply(this, arguments);
                    };
                    return origAddEventListener(type, wrappedListener, options);
                }
                return origAddEventListener(type, listener, options);
            };

            return ws;
        };

        // 프로토타입 복원 (네이티브처럼 보이게)
        window.WebSocket.prototype = _OriginalWS.prototype;
        console.log('%c[AutoKkutu] WebSocket 후킹 완료', 'color:#81c784');
    }

    function unhookWebSocket() {
        if (!wsHookActive) return;
        window.WebSocket = _OriginalWS;
        wsHookActive = false;
        console.log('[AutoKkutu] WebSocket 후킹 해제');
    }

    // ============================================================
    // 게임 상태 관리
    // ============================================================
    const GameState = {
        mode: 'laf',          // 현재 게임 모드
        condition: '',         // 현재 제시어
        myTurn: false,         // 내 턴 여부
        usedWords: new Set(),  // 사용된 단어
        kktLen: 3,             // 쿵쿵따 글자 수
        typingWord: '',        // 타자대결 제시 단어
        myUserId: null,        // 내 유저 ID
        gameSeq: [],           // 게임 순서
        turnIndex: -1,         // 현재 턴 인덱스
        gaming: false,         // 게임 중 여부
        lastEnteredWord: '',   // 마지막 입력 단어
    };

    // ============================================================
    // DOM 유틸리티 (안티치트 우회 포함)
    // ============================================================
    const DOM = {
        // 진짜 채팅 입력창 찾기 (가짜 채팅창 무시)
        // 가짜 채팅창: ID가 'UserMessage*' (MutationObserver 감지 대상)
        // 진짜 채팅창: ID가 'UserMassage*' (오타 의도적 사용)
        getChatBox() {
            // display:none이 아닌 진짜 채팅창 찾기
            return Array.from(document.querySelectorAll(
                '#Middle > div.ChatBox.Product > div.product-body > input'
            )).find(e => window.getComputedStyle(e).display !== 'none') || null;
        },

        // 진짜 전송 버튼 찾기 (가짜 버튼 무시)
        // 가짜 버튼: chatBtnf, chatBtnf2 (클릭 시 /o/c 신고)
        getSubmitBtn() {
            return Array.from(document.querySelectorAll(
                '#Middle > div.ChatBox.Product > div.product-body > button'
            )).find(e => window.getComputedStyle(e).display !== 'none') || null;
        },

        // 현재 제시어 가져오기
        getCondition() {
            const el = document.querySelector('.jjo-display.ellipse');
            if (!el) return '';
            let text = el.textContent.trim();
            // '<가>' 형태 처리 (훈민정음 등)
            text = text.replace(/[<>]/g, '');
            // '가(나)' 형태 처리 (두음법칙 대체어 포함)
            if (text.includes('(')) {
                text = text.substring(0, text.indexOf('('));
            }
            return text.trim();
        },

        // 미션 글자 가져오기
        getMissionChar() {
            const el = document.querySelector('.items');
            if (!el || parseFloat(el.style.opacity) < 1) return '';
            return el.textContent.trim();
        },

        // 내 이름 가져오기
        getMyName() {
            return document.querySelector('.my-stat-name')?.textContent?.trim() || null;
        },

        // 현재 턴 유저 이름 가져오기
        getCurrentTurnUserName() {
            return document.querySelector('.game-user-current .game-user-name')?.textContent?.trim() || null;
        },

        // 단어 히스토리 가져오기
        getWordHistory() {
            return Array.from(document.querySelectorAll('.ellipse.history-item.expl-mother'))
                .map(el => el.childNodes[0]?.textContent?.trim())
                .filter(Boolean);
        },

        // 게임 모드 텍스트 가져오기
        getGameModeText() {
            return document.querySelector('.room-head-mode')?.textContent?.trim() || '';
        },

        // 타자대결 제시 단어 가져오기
        getTypingWord() {
            const el = document.querySelector('.jjo-display.ellipse');
            if (!el) return '';
            let text = el.textContent.trim();
            // 공백 이후 제거
            if (text.includes(' ')) text = text.substring(0, text.indexOf(' '));
            return text;
        },

        // 쿵쿵따 글자 수 가져오기 (2 또는 3)
        getKktLength() {
            // 쿵쿵따 모드에서 현재 요구 글자 수 확인
            // 실제 DOM 구조 확인 필요 - 현재는 기본값 3 반환
            const el = document.querySelector('.jjo-display.ellipse');
            if (!el) return 3;
            // 단어 길이 표시 요소가 있으면 파싱
            const lengthEl = document.querySelector('.game-head-mission');
            if (lengthEl) {
                const text = lengthEl.textContent;
                if (text.includes('2글자')) return 2;
                if (text.includes('3글자')) return 3;
            }
            return 3;
        }
    };

    // ============================================================
    // 입력 시뮬레이션 (안티치트 우회)
    // ============================================================
    const Typer = {
        /**
         * 단어를 입력하고 전송합니다.
         * game_input 안티치트 우회: 입력 글자 수만큼 keyup 이벤트 발생
         * @param {string} word - 입력할 단어
         * @param {number} startDelay - 시작 딜레이 (ms)
         * @param {number} submitDelay - 전송 딜레이 (ms)
         */
        async type(word, startDelay = 0, submitDelay = 200) {
            await sleep(startDelay);

            const chatBox = DOM.getChatBox();
            const submitBtn = DOM.getSubmitBtn();

            if (!chatBox || !submitBtn) {
                console.warn('[AutoKkutu] 채팅창 또는 전송 버튼을 찾을 수 없습니다.');
                return false;
            }

            // 채팅창에 단어 입력
            chatBox.value = word;

            // React/Vue 내부 상태 업데이트 트리거
            chatBox.dispatchEvent(new Event('input', { bubbles: true }));
            chatBox.dispatchEvent(new Event('change', { bubbles: true }));

            // game_input 안티치트 우회:
            // 키 입력 횟수(_tcnt)가 단어 길이 이상이어야 함
            // isTrusted 검사 없음 (스니펫 확인됨) -> 그냥 dispatch 가능
            for (let i = 0; i < word.length; i++) {
                const keyCode = 65 + (i % 26); // A-Z 순환
                const keyEv = new KeyboardEvent('keyup', {
                    bubbles: true,
                    cancelable: true,
                    keyCode: keyCode,
                    which: keyCode,
                    key: String.fromCharCode(keyCode),
                });
                chatBox.dispatchEvent(keyEv);

                // 게임 내부 hereText에도 이벤트 전달 (game_input 카운터 증가)
                // $stage.game.hereText에 해당하는 실제 DOM 요소
                const hereText = document.querySelector('.game-input');
                if (hereText) hereText.dispatchEvent(keyEv);
            }

            // 전송 딜레이 후 버튼 클릭
            await sleep(submitDelay);

            // 전송 전 마지막으로 내 턴인지 확인
            if (!GameState.myTurn) {
                console.log('[AutoKkutu] 턴이 종료되어 입력을 취소합니다.');
                chatBox.value = '';
                return false;
            }

            submitBtn.click();
            GameState.lastEnteredWord = word;
            console.log(`%c[AutoKkutu] 입력: ${word}`, 'color:#aed581');
            return true;
        }
    };

    // ============================================================
    // 게임 모드 감지 및 자동 설정
    // ============================================================
    function detectGameMode() {
        const modeText = DOM.getGameModeText();
        if (!modeText) return null;

        const modeMap = {
            '끝말잇기': 'laf',
            '앞말잇기': 'fal',
            '끄투': 'kkutu',
            '쿵쿵따': 'kkt',
            '자유': 'free',
            '자유 끝말잇기': 'free',
            '타자 대결': 'typing',
            '훈민정음': 'hunmin',
        };

        for (const [text, mode] of Object.entries(modeMap)) {
            if (modeText.includes(text)) return mode;
        }
        return null;
    }

    // ============================================================
    // 메인 게임 루프 (DOM 폴링 방식)
    // ============================================================
    let pollTimer = null;
    let isProcessingTurn = false;

    async function onMyTurn(condition) {
        if (isProcessingTurn) return;
        isProcessingTurn = true;

        try {
            const mode = GameState.mode;

            // 타자대결 모드: 제시된 단어 그대로 입력
            if (mode === 'typing') {
                const word = DOM.getTypingWord();
                if (word) {
                    const delay = randInt(CONFIG.START_DELAY_MIN, CONFIG.START_DELAY_MAX);
                    await Typer.type(word, delay, randInt(CONFIG.SUBMIT_DELAY_MIN, CONFIG.SUBMIT_DELAY_MAX));
                }
                return;
            }

            // 훈민정음 모드: 끝말잇기와 유사하게 처리
            const effectiveMode = mode === 'hunmin' ? 'laf' : mode;

            // 단어 검색
            const candidates = DB.findWords(effectiveMode, condition, GameState.usedWords, GameState.kktLen);

            if (candidates.length === 0) {
                console.log(`%c[AutoKkutu] '${condition}'에 해당하는 단어를 찾을 수 없습니다.`, 'color:#ef9a9a');
                return;
            }

            // 최적 단어 선택
            const strategy = App.settings.wordStrategy || 'longest';
            const bestWord = DB.selectBestWord(candidates, strategy);

            if (!bestWord) return;

            // 딜레이 후 입력
            const startDelay = randInt(CONFIG.START_DELAY_MIN, CONFIG.START_DELAY_MAX);
            const submitDelay = randInt(CONFIG.SUBMIT_DELAY_MIN, CONFIG.SUBMIT_DELAY_MAX);
            await Typer.type(bestWord, startDelay, submitDelay);

        } finally {
            isProcessingTurn = false;
        }
    }

    function poll() {
        if (!App.running) return;

        // 사용된 단어 업데이트
        const history = DOM.getWordHistory();
        history.forEach(w => GameState.usedWords.add(w));

        // 게임 모드 자동 감지 (설정이 'auto'일 때)
        if (App.settings.autoDetectMode) {
            const detectedMode = detectGameMode();
            if (detectedMode && detectedMode !== GameState.mode) {
                GameState.mode = detectedMode;
                console.log(`%c[AutoKkutu] 게임 모드 자동 감지: ${detectedMode}`, 'color:#4fc3f7');
                App.gui && App.gui.updateModeDisplay(detectedMode);
            }
        }

        // 내 턴 확인
        const myName = DOM.getMyName();
        const currentTurnName = DOM.getCurrentTurnUserName();
        const isMyTurnNow = myName && currentTurnName && myName === currentTurnName;

        // 제시어 확인
        const condition = DOM.getCondition();

        // 쿵쿵따 글자 수 업데이트
        if (GameState.mode === 'kkt') {
            GameState.kktLen = DOM.getKktLength();
        }

        if (isMyTurnNow && !GameState.myTurn && condition.length > 0) {
            GameState.myTurn = true;
            GameState.condition = condition;
            console.log(`%c[AutoKkutu] 내 턴! 제시어: ${condition}`, 'color:#4fc3f7');
            onMyTurn(condition);
        } else if (!isMyTurnNow && GameState.myTurn) {
            GameState.myTurn = false;
            isProcessingTurn = false;
        }
    }

    // ============================================================
    // WebSocket 메시지 핸들러 (WS 후킹 사용 시)
    // ============================================================
    function onWebSocketMessage(data) {
        if (!App.running || !data || !data.type) return;

        switch (data.type) {
            case 'welcome':
                // 내 유저 ID 저장
                if (data.id) {
                    GameState.myUserId = String(data.id);
                    console.log(`[AutoKkutu] 내 유저 ID: ${GameState.myUserId}`);
                }
                break;

            case 'room':
                // 게임 방 정보 업데이트
                if (data.room) {
                    GameState.gaming = data.room.gaming || false;
                    if (data.room.game && data.room.game.seq) {
                        GameState.gameSeq = data.room.game.seq.map(String);
                    }
                    // 게임 모드 업데이트
                    if (data.room.mode !== undefined) {
                        const modeId = data.room.mode;
                        const modeString = getRuleName(modeId);
                        const mode = modeStringToMode(modeString);
                        if (mode && mode !== GameState.mode) {
                            GameState.mode = mode;
                            App.gui && App.gui.updateModeDisplay(mode);
                            console.log(`[AutoKkutu] WS 게임 모드: ${mode} (${modeString})`);
                        }
                    }
                    // 게임 시작 시 사용된 단어 초기화
                    if (data.room.gaming && !GameState.gaming) {
                        GameState.usedWords.clear();
                        console.log('[AutoKkutu] 게임 시작 - 사용된 단어 초기화');
                    }
                }
                break;

            case 'turnStart':
                // 턴 시작
                if (!App.running) break;
                {
                    const turn = data.turn;
                    const char = data.char || '';
                    const subChar = data.subChar || '';
                    const mission = data.mission || '';
                    const condition = char || subChar;

                    GameState.turnIndex = turn;

                    // 내 턴인지 확인 (WS 방식: gameSeq 기반)
                    const myTurnIdx = GameState.gameSeq.indexOf(GameState.myUserId);
                    const relativeTurn = GameState.gameSeq.length > 0
                        ? ((turn % GameState.gameSeq.length) + GameState.gameSeq.length) % GameState.gameSeq.length
                        : -1;

                    if (myTurnIdx >= 0 && relativeTurn === myTurnIdx && condition) {
                        GameState.myTurn = true;
                        GameState.condition = condition;
                        console.log(`%c[AutoKkutu] WS: 내 턴! 제시어: ${condition} (미션: ${mission || '없음'})`, 'color:#4fc3f7');
                        onMyTurn(condition);
                    } else {
                        GameState.myTurn = false;
                    }
                }
                break;

            case 'turnEnd':
                // 턴 종료
                {
                    // turnEnd 패킷 디코딩 (kkutu.co.kr 인코딩 처리)
                    let value = data.value || '';
                    if (data.sum && data.value) {
                        try {
                            const keyProp = String.fromCharCode(data.sum - data.score);
                            const xorKey = unescape(atob(data[keyProp]));
                            let decoded = '';
                            for (let i = 1; i < data.value.length; i++) {
                                decoded += String.fromCharCode(
                                    data.value.charCodeAt(i) ^ xorKey.charCodeAt(i - 1)
                                );
                            }
                            value = decoded;
                            console.log(`[AutoKkutu] turnEnd 디코딩: ${data.value} -> ${value}`);
                        } catch (e) {
                            console.warn('[AutoKkutu] turnEnd 디코딩 실패:', e);
                        }
                    }
                    if (value) GameState.usedWords.add(value);
                    GameState.myTurn = false;
                    isProcessingTurn = false;
                }
                break;

            case 'turnError':
                // 단어 오류 (이미 사용됨, 없는 단어 등)
                GameState.myTurn = false;
                isProcessingTurn = false;
                if (data.value) {
                    console.warn(`[AutoKkutu] 단어 오류 (코드: ${data.code}): ${data.value}`);
                }
                break;

            case 'roundReady':
                // 라운드 준비 (타자대결, 훈민정음 등)
                if (data.list) {
                    // 타자대결 단어 목록
                    GameState.typingWordList = data.list;
                    GameState.typingWordIndex = 0;
                }
                GameState.usedWords.clear();
                break;
        }
    }

    // ============================================================
    // 게임 모드 변환 유틸
    // ============================================================
    function getRuleName(modeId) {
        // RULE 요소에서 게임 모드 이름 가져오기 (kkutu.co.kr 내부 데이터)
        try {
            const ruleEl = document.getElementById('RULE');
            if (ruleEl) {
                const rules = JSON.parse(ruleEl.textContent);
                const keys = Object.keys(rules);
                return keys[modeId] || '';
            }
        } catch (_) {}
        return '';
    }

    function modeStringToMode(modeString) {
        const map = {
            'ESH': 'laf', 'KSH': 'laf',   // 끝말잇기
            'EAP': 'fal', 'KAP': 'fal',   // 앞말잇기
            'EKT': 'kkutu', 'KMT': 'kkutu', // 끄투
            'KKT': 'kkt',                  // 쿵쿵따
            'EAW': 'free', 'KAW': 'free', // 자유
            'EJH': 'free', 'KJH': 'free', // 자유 끝말잇기
            'ETY': 'typing', 'KTY': 'typing', // 타자대결
            'HUN': 'hunmin',               // 훈민정음
            'KGT': 'kkutu',               // 가운뎃말잇기 (끄투와 유사)
            'KEA': 'laf',                  // 전체
            'KAD': 'laf',                  // 전체 한국어
            'EAD': 'laf',                  // 전체 영어
        };
        return map[modeString] || null;
    }

    // ============================================================
    // GUI 패널
    // ============================================================
    const GuiPanel = {
        el: null,
        dragging: false,
        dragOffsetX: 0,
        dragOffsetY: 0,

        create() {
            if (this.el) return;

            this.el = document.createElement('div');
            this.el.id = 'autokkutu-panel';
            this.el.innerHTML = `
                <div id="ak-header">
                    <span id="ak-title">⚡ AutoKkutu</span>
                    <span id="ak-close">✕</span>
                </div>
                <div id="ak-body">
                    <div class="ak-row">
                        <label>상태</label>
                        <span id="ak-status" class="ak-stopped">정지됨</span>
                    </div>
                    <div class="ak-row">
                        <label>게임 모드</label>
                        <select id="ak-mode">
                            <option value="auto">자동 감지</option>
                            <option value="laf">끝말잇기</option>
                            <option value="fal">앞말잇기</option>
                            <option value="kkutu">끄투</option>
                            <option value="kkt">쿵쿵따</option>
                            <option value="free">자유</option>
                            <option value="typing">타자대결</option>
                            <option value="hunmin">훈민정음</option>
                        </select>
                    </div>
                    <div class="ak-row">
                        <label>단어 전략</label>
                        <select id="ak-strategy">
                            <option value="longest">긴 단어 우선</option>
                            <option value="shortest">짧은 단어 우선</option>
                            <option value="random">랜덤</option>
                        </select>
                    </div>
                    <div class="ak-row">
                        <label>시작 딜레이</label>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <input type="number" id="ak-delay-min" value="${CONFIG.START_DELAY_MIN}" min="0" max="5000" style="width:55px;">
                            <span>~</span>
                            <input type="number" id="ak-delay-max" value="${CONFIG.START_DELAY_MAX}" min="0" max="5000" style="width:55px;">
                            <span>ms</span>
                        </div>
                    </div>
                    <div class="ak-row">
                        <label>WS 후킹</label>
                        <input type="checkbox" id="ak-ws-hook" ${CONFIG.USE_WS_HOOK ? 'checked' : ''}>
                        <span style="font-size:10px;color:#aaa;">(재시작 필요)</span>
                    </div>
                    <div class="ak-row">
                        <label>자동 모드 감지</label>
                        <input type="checkbox" id="ak-auto-mode" checked>
                    </div>
                    <div id="ak-info">
                        <span>제시어: <b id="ak-condition">-</b></span>
                        <span>사용 단어: <b id="ak-used-count">0</b></span>
                        <span>마지막 입력: <b id="ak-last-word">-</b></span>
                    </div>
                    <div id="ak-buttons">
                        <button id="ak-start">▶ 시작</button>
                        <button id="ak-stop">■ 정지</button>
                        <button id="ak-reload-db">DB 재로드</button>
                    </div>
                    <div id="ak-db-status">DB: 로딩 전</div>
                </div>
            `;

            // 스타일
            const style = document.createElement('style');
            style.textContent = `
                #autokkutu-panel {
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    width: 280px;
                    background: rgba(18, 18, 24, 0.95);
                    color: #e0e0e0;
                    border: 1px solid #333;
                    border-radius: 10px;
                    font-family: 'Malgun Gothic', sans-serif;
                    font-size: 12px;
                    z-index: 2147483647;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    user-select: none;
                    backdrop-filter: blur(8px);
                }
                #ak-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    background: rgba(79, 195, 247, 0.15);
                    border-radius: 10px 10px 0 0;
                    cursor: move;
                    border-bottom: 1px solid #333;
                }
                #ak-title { font-weight: bold; font-size: 14px; color: #4fc3f7; }
                #ak-close { cursor: pointer; color: #aaa; font-size: 16px; padding: 0 4px; }
                #ak-close:hover { color: #ef5350; }
                #ak-body { padding: 10px 12px; }
                .ak-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 7px;
                    gap: 8px;
                }
                .ak-row label {
                    width: 80px;
                    color: #9e9e9e;
                    font-size: 11px;
                    flex-shrink: 0;
                }
                .ak-row select, .ak-row input[type="number"] {
                    background: #1e1e2e;
                    color: #e0e0e0;
                    border: 1px solid #444;
                    border-radius: 4px;
                    padding: 3px 5px;
                    font-size: 11px;
                }
                .ak-row select { flex: 1; }
                #ak-status { font-weight: bold; }
                .ak-stopped { color: #ef5350; }
                .ak-running { color: #66bb6a; }
                #ak-info {
                    background: #1a1a2e;
                    border-radius: 5px;
                    padding: 6px 8px;
                    margin: 8px 0;
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    font-size: 11px;
                    color: #bbb;
                }
                #ak-info b { color: #4fc3f7; }
                #ak-buttons {
                    display: flex;
                    gap: 5px;
                    margin-top: 5px;
                }
                #ak-buttons button {
                    flex: 1;
                    padding: 5px;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: bold;
                    transition: opacity 0.2s;
                }
                #ak-buttons button:hover { opacity: 0.85; }
                #ak-start { background: #2e7d32; color: white; }
                #ak-stop { background: #c62828; color: white; }
                #ak-reload-db { background: #1565c0; color: white; }
                #ak-db-status {
                    margin-top: 6px;
                    font-size: 10px;
                    color: #757575;
                    text-align: center;
                }
            `;
            document.head.appendChild(style);
            document.body.appendChild(this.el);

            // 이벤트 바인딩
            this.el.querySelector('#ak-close').onclick = () => this.destroy();
            this.el.querySelector('#ak-start').onclick = () => App.start();
            this.el.querySelector('#ak-stop').onclick = () => App.stop();
            this.el.querySelector('#ak-reload-db').onclick = () => App.reloadDB();

            this.el.querySelector('#ak-mode').onchange = (e) => {
                const val = e.target.value;
                if (val === 'auto') {
                    App.settings.autoDetectMode = true;
                } else {
                    App.settings.autoDetectMode = false;
                    GameState.mode = val;
                }
            };

            this.el.querySelector('#ak-strategy').onchange = (e) => {
                App.settings.wordStrategy = e.target.value;
            };

            this.el.querySelector('#ak-delay-min').onchange = (e) => {
                CONFIG.START_DELAY_MIN = parseInt(e.target.value) || 0;
            };
            this.el.querySelector('#ak-delay-max').onchange = (e) => {
                CONFIG.START_DELAY_MAX = parseInt(e.target.value) || 0;
            };

            this.el.querySelector('#ak-ws-hook').onchange = (e) => {
                CONFIG.USE_WS_HOOK = e.target.checked;
            };

            this.el.querySelector('#ak-auto-mode').onchange = (e) => {
                App.settings.autoDetectMode = e.target.checked;
            };

            // 드래그 이동
            const header = this.el.querySelector('#ak-header');
            header.onmousedown = (e) => {
                this.dragging = true;
                this.dragOffsetX = e.clientX - this.el.offsetLeft;
                this.dragOffsetY = e.clientY - this.el.offsetTop;
            };
            document.onmousemove = (e) => {
                if (!this.dragging) return;
                this.el.style.left = (e.clientX - this.dragOffsetX) + 'px';
                this.el.style.top = (e.clientY - this.dragOffsetY) + 'px';
                this.el.style.right = 'auto';
            };
            document.onmouseup = () => { this.dragging = false; };

            // 주기적 정보 업데이트
            setInterval(() => this.updateInfo(), 500);
        },

        updateInfo() {
            if (!this.el) return;
            const condEl = this.el.querySelector('#ak-condition');
            const usedEl = this.el.querySelector('#ak-used-count');
            const lastEl = this.el.querySelector('#ak-last-word');
            if (condEl) condEl.textContent = GameState.condition || '-';
            if (usedEl) usedEl.textContent = GameState.usedWords.size;
            if (lastEl) lastEl.textContent = GameState.lastEnteredWord || '-';
        },

        updateStatus(running) {
            if (!this.el) return;
            const statusEl = this.el.querySelector('#ak-status');
            if (!statusEl) return;
            statusEl.textContent = running ? '실행 중' : '정지됨';
            statusEl.className = running ? 'ak-running' : 'ak-stopped';
        },

        updateModeDisplay(mode) {
            if (!this.el) return;
            const sel = this.el.querySelector('#ak-mode');
            if (sel && sel.value !== mode) sel.value = mode;
        },

        updateDBStatus(msg) {
            if (!this.el) return;
            const el = this.el.querySelector('#ak-db-status');
            if (el) el.textContent = msg;
        },

        destroy() {
            if (this.el) {
                this.el.remove();
                this.el = null;
            }
        }
    };

    // ============================================================
    // 메인 앱
    // ============================================================
    const App = {
        running: false,
        gui: GuiPanel,
        settings: {
            autoDetectMode: true,
            wordStrategy: 'longest',
        },

        async init() {
            console.log('%c[AutoKkutu] 초기화 중...', 'color:#4fc3f7;font-size:14px;font-weight:bold;');

            // 안티치트 우회: axios /o/c 차단
            setupAxiosInterceptor();

            // GUI 생성
            this.gui.create();
            this.gui.updateDBStatus('DB: 로딩 중...');

            // DB 로드
            const ok = await DB.load(CONFIG.DB_URL);
            if (ok) {
                const total = Object.values(DB.laf).reduce((a, b) => a + b.length, 0);
                this.gui.updateDBStatus(`DB: ${total.toLocaleString()}개 단어 로드됨`);
            } else {
                this.gui.updateDBStatus('DB: 로드 실패 - DB_URL을 확인하세요');
            }

            // WebSocket 후킹
            if (CONFIG.USE_WS_HOOK) {
                hookWebSocket(onWebSocketMessage);
            }

            console.log('%c[AutoKkutu] 초기화 완료! GUI 패널을 확인하세요.', 'color:#81c784;font-size:14px;font-weight:bold;');

            if (CONFIG.AUTO_START) this.start();
        },

        start() {
            if (this.running) return;
            if (!DB.loaded) {
                console.warn('[AutoKkutu] DB가 로드되지 않았습니다. DB_URL을 확인하세요.');
                return;
            }
            this.running = true;
            GameState.usedWords.clear();
            GameState.myTurn = false;
            isProcessingTurn = false;
            pollTimer = setInterval(poll, CONFIG.POLL_INTERVAL);
            this.gui.updateStatus(true);
            console.log('%c[AutoKkutu] 시작됨', 'color:#66bb6a;font-weight:bold;');
        },

        stop() {
            if (!this.running) return;
            this.running = false;
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            GameState.myTurn = false;
            isProcessingTurn = false;
            this.gui.updateStatus(false);
            console.log('[AutoKkutu] 정지됨');
        },

        async reloadDB() {
            this.gui.updateDBStatus('DB: 재로딩 중...');
            const ok = await DB.load(CONFIG.DB_URL);
            if (ok) {
                const total = Object.values(DB.laf).reduce((a, b) => a + b.length, 0);
                this.gui.updateDBStatus(`DB: ${total.toLocaleString()}개 단어 로드됨`);
            } else {
                this.gui.updateDBStatus('DB: 로드 실패');
            }
        },

        setMode(mode) {
            GameState.mode = mode;
            this.settings.autoDetectMode = (mode === 'auto');
        },

        // 외부에서 DB URL 변경 후 재로드
        async loadDB(url) {
            CONFIG.DB_URL = url;
            await this.reloadDB();
        }
    };

    // ============================================================
    // 유틸리티
    // ============================================================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // ============================================================
    // 전역 등록 및 실행
    // ============================================================
    window.AutoKkutu = App;

    // 초기화 실행
    App.init();

    console.log(`
%c╔══════════════════════════════════════╗
║        AutoKkutu.js 로드됨           ║
╠══════════════════════════════════════╣
║  window.AutoKkutu.start()  - 시작    ║
║  window.AutoKkutu.stop()   - 정지    ║
║  window.AutoKkutu.loadDB(url) - DB   ║
╚══════════════════════════════════════╝`, 'color:#4fc3f7;font-family:monospace;');

})();
