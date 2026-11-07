const birdButton = document.querySelector("#bird-button");
const birdImage = document.querySelector("#bluebird");
const likeForm = document.querySelector("#like-form");
const likeInput = document.querySelector("#like-input");
const likeList = document.querySelector("#like-list");
const listStatus = document.querySelector("#list-status");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatThread = document.querySelector("#chat-thread");
const chatSend = document.querySelector("#chat-send");
const chatStatus = document.querySelector("#chat-status");
const systemPromptText = document.querySelector("#system-prompt-text");
const temperatureInput = document.querySelector("#temperature");
const topPInput = document.querySelector("#top-p");
const maxTokensInput = document.querySelector("#max-tokens");

// Keep the visitor's additions in memory for this page view only.
const favorites = [];

// Keep chat history in memory too; it is sent only when asking the guide again.
const conversationHistory = [];
let isSendingChat = false;

birdButton.addEventListener("click", () => {
  if (birdImage.classList.contains("bird--shake")) return;

  birdImage.classList.add("bird--shake");
  birdImage.addEventListener("animationend", () => {
    birdImage.classList.remove("bird--shake");
  }, { once: true });
});

likeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const favorite = likeInput.value.trim();

  if (!favorite) {
    likeInput.focus();
    return;
  }

  favorites.push(favorite);
  const item = document.createElement("li");
  item.textContent = favorites[favorites.length - 1];
  likeList.append(item);

  likeInput.value = "";
  listStatus.textContent = `Added to your list. ${favorites.length} ${favorites.length === 1 ? "favorite" : "favorites"} so far.`;
  likeInput.focus();
});

// Read the exact prompt used by the API so visitors can inspect it in Prompt Lab.
fetch("/api/chat/system-prompt")
  .then((response) => {
    if (!response.ok) throw new Error("Prompt unavailable.");
    return response.json();
  })
  .then(({ systemPrompt }) => {
    systemPromptText.textContent = systemPrompt;
  })
  .catch(() => {
    systemPromptText.textContent = "The city guide prompt is unavailable right now.";
  });

// Keep the value labels in sync while a visitor moves each Prompt Lab slider.
temperatureInput.addEventListener("input", () => {
  document.querySelector("#temperature-value").value = Number(temperatureInput.value).toFixed(1);
});

topPInput.addEventListener("input", () => {
  document.querySelector("#top-p-value").value = Number(topPInput.value).toFixed(2);
});

maxTokensInput.addEventListener("input", () => {
  document.querySelector("#max-tokens-value").value = maxTokensInput.value;
});

function addChatMessage(role, text, extraClass = "") {
  const message = document.createElement("article");
  message.className = `chat-message chat-message--${role}${extraClass ? ` ${extraClass}` : ""}`;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text;

  const meta = document.createElement("p");
  meta.className = "chat-meta";
  meta.textContent = role === "user" ? "You" : "St. Louis city guide";

  message.append(bubble, meta);
  chatThread.append(message);
  chatThread.scrollTop = chatThread.scrollHeight;
  return message;
}

function readChatSettings() {
  return {
    temperature: Number(temperatureInput.value),
    topP: Number(topPInput.value),
    maxOutputTokens: Number(maxTokensInput.value),
  };
}

function formatTokenCount(value) {
  return Number.isInteger(value) ? value.toLocaleString() : "unavailable";
}

function showChatReply(messageElement, result) {
  messageElement.querySelector(".chat-bubble").textContent = result.reply;

  const settings = result.settings;
  const usage = result.usage;
  const meta = messageElement.querySelector(".chat-meta");
  meta.textContent =
    `Temperature ${settings.temperature.toFixed(1)} · Top-p ${settings.topP.toFixed(2)} · ` +
    `Max ${settings.maxOutputTokens} tokens | ` +
    `Tokens: ${formatTokenCount(usage.promptTokens)} in / ` +
    `${formatTokenCount(usage.outputTokens)} out / ` +
    `${formatTokenCount(usage.totalTokens)} total | ${result.model}`;

  const wasCutOff =
    usage.finishReason.toUpperCase().includes("MAX_TOKENS") ||
    (Number.isInteger(usage.outputTokens) &&
      usage.outputTokens >= settings.maxOutputTokens);

  if (wasCutOff) {
    const cutoffNote = document.createElement("p");
    cutoffNote.className = "chat-cutoff";
    cutoffNote.textContent = "This answer may be cut off. Increase max output tokens in Prompt Lab for a longer reply.";
    messageElement.append(cutoffNote);
  }
  chatThread.scrollTop = chatThread.scrollHeight;
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSendingChat) return;

  const message = chatInput.value.trim();
  if (!message) {
    chatInput.focus();
    return;
  }

  isSendingChat = true;
  chatSend.disabled = true;
  chatSend.textContent = "Asking…";
  chatStatus.textContent = "Your local guide is thinking…";
  addChatMessage("user", message);
  const pendingMessage = addChatMessage("assistant", "Let me think on that a moment…", "chat-message--pending");
  chatInput.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: conversationHistory.slice(-20),
        settings: readChatSettings(),
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "The city guide could not answer just now.");
    }

    pendingMessage.classList.remove("chat-message--pending");
    showChatReply(pendingMessage, data);
    conversationHistory.push(
      { role: "user", content: message },
      { role: "assistant", content: data.reply },
    );
    if (conversationHistory.length > 20) conversationHistory.splice(0, conversationHistory.length - 20);
    chatStatus.textContent = "Ask another question whenever you’re ready.";
  } catch (error) {
    pendingMessage.classList.remove("chat-message--pending");
    pendingMessage.classList.add("chat-message--error");
    pendingMessage.querySelector(".chat-bubble").textContent =
      error instanceof Error ? error.message : "The city guide could not answer just now.";
    chatStatus.textContent = "Check your connection or try again in a moment.";
  } finally {
    isSendingChat = false;
    chatSend.disabled = false;
    chatSend.innerHTML = 'Send <span aria-hidden="true">↗</span>';
    chatInput.focus();
  }
});

document.querySelectorAll(".prompt-chip").forEach((button) => {
  button.addEventListener("click", () => {
    if (isSendingChat) return;
    chatInput.value = button.dataset.question;
    chatForm.requestSubmit();
  });
});

// Let Enter send a question while Shift+Enter adds a new line.
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
