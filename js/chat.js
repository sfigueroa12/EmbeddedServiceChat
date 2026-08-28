(function () {
  const TOKEN_STORAGE_KEY = "sacChatIdentityToken";
  const USERNAME_STORAGE_KEY = "sacChatPrechatUsername";
  const config = window.CHAT_CONFIG;

  const loginPanel = document.getElementById("login-panel");
  const sessionPanel = document.getElementById("session-panel");
  const jwtInput = document.getElementById("jwt-input");
  const usernameInput = document.getElementById("username-input");
  const statusEl = document.getElementById("status");
  const subjectEl = document.getElementById("token-subject");
  const expiryEl = document.getElementById("token-expiry");
  const usernameDisplayEl = document.getElementById("prechat-username");
  const startButton = document.getElementById("start-chat");
  const logoutButton = document.getElementById("logout");
  const errorEl = document.getElementById("error");

  let chatInitialized = false;
  let chatButtonCreated = false;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || "";
  }

  function decodeJwtPart(part) {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(atob(padded));
  }

  function decodeJwt(token) {
    const parts = token.split(".");
    if (parts.length < 2) {
      throw new Error("El valor pegado no es un JWT válido.");
    }
    return {
      header: decodeJwtPart(parts[0]),
      payload: decodeJwtPart(parts[1]),
    };
  }

  function describeToken(token) {
    const { header, payload } = decodeJwt(token);
    const warnings = [];

    subjectEl.textContent = payload.sub || "(sin sub)";
    if (payload.exp) {
      expiryEl.textContent = new Date(payload.exp * 1000).toLocaleString("es-ES");
      if (payload.exp * 1000 <= Date.now()) {
        warnings.push("El JWT ya está caducado (claim exp).");
      }
    } else {
      expiryEl.textContent = "(sin exp)";
      warnings.push("El JWT no tiene claim exp.");
    }

    const alg = header.alg || "";
    if (alg !== "RS256" && alg !== "RS512") {
      warnings.push("alg debe ser RS256 o RS512. Ahora es " + (alg || "(vacío)") + ".");
    }
    if (!header.kid) {
      warnings.push("Falta kid en el header del JWT. Debe coincidir con la JWK del Keyset.");
    }
    if (!payload.iss) {
      warnings.push("Falta iss. Debe coincidir con el JSON Web Key Issuer del Keyset.");
    }
    if (!payload.sub) {
      warnings.push("Falta sub.");
    }

    setError(warnings.join(" "));
    return { header, payload, warnings };
  }

  function getStoredToken() {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  }

  function getStoredUsername() {
    return sessionStorage.getItem(USERNAME_STORAGE_KEY) || "";
  }

  function storeSession(token, username) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(USERNAME_STORAGE_KEY, username);
  }

  function clearSessionStorage() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(USERNAME_STORAGE_KEY);
  }

  function showLoggedOut() {
    loginPanel.hidden = false;
    sessionPanel.hidden = true;
    jwtInput.value = "";
    usernameInput.value = "";
  }

  function showLoggedIn(token, username) {
    loginPanel.hidden = true;
    sessionPanel.hidden = false;
    describeToken(token);
    usernameDisplayEl.textContent = username || "(sin username)";
  }

  function registerMessagingListeners() {
    window.addEventListener("onEmbeddedMessagingReady", async () => {
      const token = getStoredToken();
      const username = getStoredUsername();

      if (!token) {
        setStatus("Chat listo, pero no hay JWT.");
        return;
      }

      try {
        embeddedservice_bootstrap.userVerificationAPI.setIdentityToken({
          identityTokenType: "JWT",
          identityToken: token,
        });
        if (username) {
          embeddedservice_bootstrap.prechatAPI.setHiddenPrechatFields({
            Username: username,
          });
        }
        setStatus(
          "Token enviado al cliente. Esperando onEmbeddedMessagingButtonCreated. Sin ese evento el JWT no ha sido aceptado (Salesforce no suele pintar un error en consola)."
        );
        window.setTimeout(function () {
          if (!chatButtonCreated) {
            setStatus(
              "El launcher no se ha creado. Eso encaja con un JWT rechazado en silencio: revisa kid, iss, firma RS256 y que el Keyset esté en el canal. En Red filtra scrt o iamessage."
            );
          }
        }, 8000);
      } catch (error) {
        setStatus("No se pudo enviar el JWT.");
        setError(error.message || String(error));
      }
    });

    window.addEventListener("onEmbeddedMessagingButtonCreated", () => {
      chatButtonCreated = true;
      setStatus(
        "Salesforce ha creado el botón de chat. Si no lo ves, está oculto (horario de oficina o hideChatButtonOnLoad). Mira la esquina inferior derecha."
      );
    });

    window.addEventListener("onEmbeddedMessagingBusinessHoursEnded", () => {
      setStatus("Fuera de horario de oficina: el botón puede crearse pero quedarse oculto.");
    });

    window.addEventListener("onEmbeddedMessagingIdentityTokenExpired", () => {
      setStatus("El JWT ha caducado. Genera uno nuevo y vuelve a entrar.");
      setError("Tienes 30 segundos para pegar un JWT nuevo. Si no, la sesión de chat se limpia sola.");
    });
  }

  function loadSalesforceSnippet() {
    if (chatInitialized) {
      return;
    }
    chatInitialized = true;
    registerMessagingListeners();

    window.initEmbeddedMessaging = function initEmbeddedMessaging() {
      try {
        embeddedservice_bootstrap.settings.language = config.language;
        embeddedservice_bootstrap.init(config.orgId, config.deploymentName, config.siteUrl, {
          scrt2URL: config.scrt2Url,
        });
      } catch (error) {
        setStatus("Error al iniciar Embedded Messaging.");
        setError(error.message || String(error));
      }
    };

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = config.siteUrl + "/assets/js/bootstrap.min.js";
    script.onload = window.initEmbeddedMessaging;
    script.onerror = function () {
      setStatus("No se pudo cargar bootstrap.min.js.");
      setError(
        "Revisa CORS y los dominios permitidos del deployment. GitHub Pages debe estar autorizado en Salesforce."
      );
    };
    document.body.appendChild(script);
  }

  startButton.addEventListener("click", function () {
    const token = jwtInput.value.trim();
    const username = usernameInput.value.trim();
    setError("");

    if (!token) {
      setError("Pega un JWT generado con tu clave privada.");
      return;
    }

    try {
      describeToken(token);
    } catch (error) {
      setError(error.message);
      return;
    }

    storeSession(token, username);
    showLoggedIn(token, username);
    setStatus("Sesión de prueba iniciada. Cargando Enhanced Chat…");
    loadSalesforceSnippet();
  });

  logoutButton.addEventListener("click", function () {
    const api = window.embeddedservice_bootstrap && embeddedservice_bootstrap.userVerificationAPI;
    if (api) {
      api.clearSession(true).catch(function () {
        /* El logout de prueba debe continuar aunque Salesforce falle. */
      });
    }
    clearSessionStorage();
    showLoggedOut();
    setStatus("Sesión de chat limpiada. Recarga la página si el widget sigue visible.");
  });

  const existingToken = getStoredToken();
  if (existingToken) {
    try {
      const existingUsername = getStoredUsername();
      showLoggedIn(existingToken, existingUsername);
      setStatus("JWT recuperado de esta pestaña. Cargando Enhanced Chat…");
      loadSalesforceSnippet();
    } catch (error) {
      clearSessionStorage();
      showLoggedOut();
      setError("El JWT guardado no es válido. Pega uno nuevo.");
    }
  } else {
    showLoggedOut();
    setStatus("Pega un JWT y, si aplica, un Username para simular el login del área reservada.");
  }
})();
