/* ============================================================
   CodeDock Studio — Error Logger
   Перехватывает все ошибки и отправляет в CodeDockConsole.
   Подключать ПОСЛЕ основного скрипта (или в конце body).
   ============================================================ */
(function () {
    'use strict';

    if (window.__errorLoggerActive) return;
    window.__errorLoggerActive = true;

    // --- Ждём, пока основной скрипт создаст __consolePanel ---
    function waitForConsole(cb, attempts = 0) {
        if (window.__consolePanel && typeof window.__consolePanel.log === 'function') {
            cb(window.__consolePanel);
            return;
        }
        if (attempts > 100) { // ~10 секунд
            console.warn('[ErrorLogger] __consolePanel не найден, логгер работает в фоновом режиме');
            cb(null);
            return;
        }
        setTimeout(() => waitForConsole(cb, attempts + 1), 100);
    }

    function stringifyArg(a) {
        if (a instanceof Error) return a.name + ': ' + a.message;
        if (typeof a === 'object' && a !== null) {
            try { return JSON.stringify(a); } catch (e) { return String(a); }
        }
        return String(a);
    }

    waitForConsole(function (consolePanel) {
        const safeLog = (type, message, stack) => {
            try {
                if (consolePanel) consolePanel.log(type, message, stack || '');
                else console.log('[ErrorLogger]', type, message, stack || '');
            } catch (e) {
                // fallback, если consolePanel сломан
                console.log('[ErrorLogger fallback]', type, message, e);
            }
        };

        // 1. Глобальные JS-ошибки
        const originalOnError = window.onerror;
        window.onerror = function (message, source, lineno, colno, error) {
            const stack = error && error.stack ? error.stack : '';
            const src = source ? ` (${String(source).split('/').pop()}:${lineno}:${colno})` : '';
            safeLog('error', `[Global] ${message}${src}`, stack);
            if (typeof originalOnError === 'function') {
                try { originalOnError.apply(window, arguments); } catch (e) { }
            }
            return false;
        };

        // 2. Необработанные Promise rejection
        window.addEventListener('unhandledrejection', function (event) {
            const reason = event.reason;
            let msg = 'Необработанная ошибка Promise';
            let stack = '';
            if (reason instanceof Error) {
                msg += ': ' + reason.message;
                stack = reason.stack || '';
            } else if (typeof reason === 'string') {
                msg += ': ' + reason;
            } else {
                try { msg += ': ' + JSON.stringify(reason); } catch (e) { msg += ': [object]'; }
            }
            safeLog('error', `[Promise] ${msg}`, stack);
        });

        // 3. Перехват console.error / console.warn (OPFS, ZIP, Service Worker и т.д.)
        const origError = console.error.bind(console);
        const origWarn = console.warn.bind(console);

        console.error = function () {
            origError.apply(console, arguments);
            const msg = Array.prototype.map.call(arguments, stringifyArg).join(' ');
            safeLog('error', `[console.error] ${msg}`);
        };

        console.warn = function () {
            origWarn.apply(console, arguments);
            const msg = Array.prototype.map.call(arguments, stringifyArg).join(' ');
            safeLog('warn', `[console.warn] ${msg}`);
        };

        // 4. Ошибки из iframe предпросмотра (дополнительный канал)
        window.addEventListener('message', function (event) {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'codedock-error') {
                safeLog('error', `[iframe] ${data.message || ''}`, data.stack || '');
            }
        });

        // 5. Ошибки CodeMirror (если есть)
        if (window.CodeMirror && window.CodeMirror.on) {
            try {
                // CodeMirror не имеет события 'error', но можно ловить через его внутренние
                // Здесь просто логируем факт загрузки
                safeLog('info', '[Logger] CodeMirror обнаружен');
            } catch (e) { }
        }

        // 6. Сообщаем о старте
        safeLog('info', '[Logger] Перехват ошибок активирован');
    });
})();