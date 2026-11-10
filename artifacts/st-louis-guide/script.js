const birdButton = document.querySelector("#bird-button");
const birdImage = document.querySelector("#bluebird");
const likeForm = document.querySelector("#like-form");
const likeInput = document.querySelector("#like-input");
const likeList = document.querySelector("#like-list");
const listStatus = document.querySelector("#list-status");
const dishUploadForm = document.querySelector("#dish-upload-form");
const dishTitleInput = document.querySelector("#dish-title");
const dishCaptionInput = document.querySelector("#dish-caption");
const dishImageInput = document.querySelector("#dish-image");
const dishUploadButton = document.querySelector("#dish-upload-button");
const dishUploadStatus = document.querySelector("#dish-upload-status");
const dishGalleryGrid = document.querySelector("#dish-gallery-grid");
const dishGalleryStatus = document.querySelector("#dish-gallery-status");
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
const MAX_DISH_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DISH_IMAGE_EDGE = 1280;
const ACCEPTED_DISH_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The photo could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function resizeDishPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    MAX_DISH_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("Your browser could not prepare this photo.");
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const resizedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Your browser could not resize this photo."));
      },
      file.type,
      0.86,
    );
  });

  if (!ACCEPTED_DISH_IMAGE_TYPES.has(resizedBlob.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  }
  if (resizedBlob.size > MAX_DISH_IMAGE_BYTES) {
    throw new Error("This photo is still over 3 MB after resizing. Choose a smaller image.");
  }

  return readBlobAsDataUrl(resizedBlob);
}

function formatDishDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function createDishPhotoCard(photo) {
  const card = document.createElement("article");
  card.className = "dish-photo-card";

  const figure = document.createElement("figure");
  figure.className = "dish-photo-figure";
  const image = document.createElement("img");
  image.src = photo.imageUrl;
  image.alt = photo.caption
    ? `${photo.title}: ${photo.caption}`
    : photo.title;
  image.loading = "lazy";
  image.decoding = "async";
  figure.append(image);

  const copy = document.createElement("div");
  copy.className = "dish-photo-copy";
  const title = document.createElement("h3");
  title.textContent = photo.title;
  copy.append(title);

  if (photo.caption) {
    const caption = document.createElement("p");
    caption.textContent = photo.caption;
    copy.append(caption);
  }

  if (photo.inspectorNote) {
    const note = document.createElement("p");
    note.className = "dish-inspector-note";
    note.textContent = photo.inspectorNote;
    copy.append(note);
  }

  const date = document.createElement("time");
  date.className = "dish-photo-date";
  date.dateTime = photo.createdAt;
  date.textContent = formatDishDate(photo.createdAt);
  copy.append(date);

  card.append(figure, copy);
  return card;
}

function showEmptyDishGallery() {
  dishGalleryStatus.textContent = "No photos yet. Share the first plate!";
}

async function loadDishGallery() {
  try {
    const response = await fetch("/api/dishes");
    const photos = await response.json();
    if (!response.ok) {
      throw new Error(photos.error || "The dish gallery could not load.");
    }

    dishGalleryGrid.replaceChildren();
    photos.forEach((photo) => {
      dishGalleryGrid.append(createDishPhotoCard(photo));
    });
    if (photos.length === 0) showEmptyDishGallery();
    else dishGalleryStatus.textContent = "";
  } catch (error) {
    dishGalleryStatus.textContent =
      error instanceof Error
        ? error.message
        : "The dish gallery could not load. Please refresh the page.";
    dishGalleryStatus.classList.add("dish-gallery-status--error");
  }
}

dishUploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = dishTitleInput.value.trim();
  const caption = dishCaptionInput.value.trim();
  const file = dishImageInput.files[0];

  if (!title) {
    dishUploadStatus.textContent = "Add a name for the dish.";
    dishTitleInput.focus();
    return;
  }
  if (!file) {
    dishUploadStatus.textContent = "Choose a photo to share.";
    dishImageInput.focus();
    return;
  }
  if (!ACCEPTED_DISH_IMAGE_TYPES.has(file.type)) {
    dishUploadStatus.textContent = "Choose a JPEG, PNG, or WebP photo. GIFs are not supported.";
    dishImageInput.value = "";
    return;
  }
  if (file.size > MAX_DISH_IMAGE_BYTES) {
    dishUploadStatus.textContent = "This photo is over 3 MB. Choose a smaller image.";
    dishImageInput.value = "";
    return;
  }

  dishUploadButton.disabled = true;
  dishUploadForm.setAttribute("aria-busy", "true");
  dishUploadStatus.classList.remove("dish-upload-status--error");
  dishUploadStatus.textContent = "Preparing your photo…";

  try {
    const image = await resizeDishPhoto(file);
    dishUploadStatus.textContent = "Inspecting your photo for toasted ravioli…";

    const response = await fetch("/api/dishes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, caption, image }),
    });
    const savedPhoto = await response.json();
    if (!response.ok) {
      throw new Error([savedPhoto.error || "Your photo could not be uploaded.", savedPhoto.reason].filter(Boolean).join(" "));
    }

    const emptyMessage = dishGalleryStatus.textContent.startsWith("No photos")
      ? true
      : false;
    if (emptyMessage) dishGalleryStatus.textContent = "";
    dishGalleryGrid.prepend(createDishPhotoCard(savedPhoto));
    dishUploadForm.reset();
    dishUploadStatus.textContent = "Your photo is at the top of the gallery. Thanks for sharing!";
  } catch (error) {
    dishUploadStatus.classList.add("dish-upload-status--error");
    dishUploadStatus.textContent =
      error instanceof Error
        ? error.message
        : "Your photo could not be uploaded. Please try again.";
  } finally {
    dishUploadButton.disabled = false;
    dishUploadForm.removeAttribute("aria-busy");
  }
});

loadDishGallery();

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

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 45_000);
  const slowNoticeId = window.setTimeout(() => {
    pendingMessage.querySelector(".chat-bubble").textContent =
      "The guide is taking longer than usual. I’m still waiting for a reply…";
    chatStatus.textContent = "Gemini is busy; this request will time out instead of waiting forever.";
  }, 15_000);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
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
      error instanceof DOMException && error.name === "AbortError"
        ? "The city guide took too long to answer. Please try again."
        : error instanceof Error
          ? error.message
          : "The city guide could not answer just now.";
    chatInput.value = message;
    chatStatus.textContent = "Your question is ready to send again.";
  } finally {
    window.clearTimeout(timeoutId);
    window.clearTimeout(slowNoticeId);
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
