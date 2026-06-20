(() => {
  if (globalThis.nebulaExtensionApi) return;

  const nativeBrowser = globalThis.browser;
  const nativeChrome = globalThis.chrome;

  function makeChromeCompat(browserApi) {
    let lastError = null;
    const messageListeners = new Map();

    function popCallback(args) {
      return typeof args[args.length - 1] === "function" ? args.pop() : null;
    }

    function setLastError(error) {
      lastError = { message: error?.message || String(error) };
      setTimeout(() => { lastError = null; }, 0);
    }

    function invoke(promiseFactory, callback) {
      try {
        const promise = Promise.resolve(promiseFactory());
        if (callback) {
          promise.then(
            (value) => callback(value),
            (error) => {
              setLastError(error);
              callback();
            }
          );
          return undefined;
        }
        return promise;
      } catch (error) {
        if (callback) {
          setLastError(error);
          callback();
          return undefined;
        }
        return Promise.reject(error);
      }
    }

    const compat = {
      runtime: {
        get lastError() {
          return lastError;
        },
        onMessage: {
          addListener(listener) {
            if (messageListeners.has(listener)) return;
            const wrapped = (message, sender) => {
              let responseSent = false;
              let resolveResponse;
              const responsePromise = new Promise((resolve) => {
                resolveResponse = resolve;
              });
              const sendResponse = (response) => {
                responseSent = true;
                resolveResponse(response);
              };

              const result = listener(message, sender, sendResponse);
              if (result === true) return responsePromise;
              if (result && typeof result.then === "function") return result;
              if (responseSent) return responsePromise;
              return result;
            };
            messageListeners.set(listener, wrapped);
            browserApi.runtime.onMessage.addListener(wrapped);
          },
          removeListener(listener) {
            const wrapped = messageListeners.get(listener);
            if (!wrapped) return;
            browserApi.runtime.onMessage.removeListener(wrapped);
            messageListeners.delete(listener);
          },
          hasListener(listener) {
            const wrapped = messageListeners.get(listener);
            return wrapped ? browserApi.runtime.onMessage.hasListener(wrapped) : false;
          },
        },
        sendMessage(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.runtime.sendMessage(...args), callback);
        },
        getURL: browserApi.runtime.getURL?.bind(browserApi.runtime),
      },
      storage: {
        local: {
          get(...args) {
            const callback = popCallback(args);
            return invoke(() => browserApi.storage.local.get(...args), callback);
          },
          set(...args) {
            const callback = popCallback(args);
            return invoke(() => browserApi.storage.local.set(...args), callback);
          },
          remove(...args) {
            const callback = popCallback(args);
            return invoke(() => browserApi.storage.local.remove(...args), callback);
          },
        },
        onChanged: browserApi.storage.onChanged,
      },
      tabs: {
        query(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.tabs.query(...args), callback);
        },
        get(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.tabs.get(...args), callback);
        },
        sendMessage(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.tabs.sendMessage(...args), callback);
        },
        onUpdated: browserApi.tabs.onUpdated,
        onActivated: browserApi.tabs.onActivated,
      },
      scripting: {
        executeScript(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.scripting.executeScript(...args), callback);
        },
      },
      action: {
        setBadgeText(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.action.setBadgeText(...args), callback);
        },
        setBadgeBackgroundColor(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.action.setBadgeBackgroundColor(...args), callback);
        },
      },
      commands: {
        onCommand: browserApi.commands.onCommand,
      },
      notifications: {
        create(...args) {
          const callback = popCallback(args);
          return invoke(() => browserApi.notifications.create(...args), callback);
        },
      },
    };

    return compat;
  }

  if (nativeBrowser) {
    globalThis.chrome = makeChromeCompat(nativeBrowser);
  }

  globalThis.nebulaExtensionApi = {
    raw: nativeBrowser || nativeChrome || globalThis.chrome,
    isFirefoxPromiseApi: !!nativeBrowser,
  };
})();
