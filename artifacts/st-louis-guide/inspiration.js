const grid = document.querySelector("#inspiration-grid");
const status = document.querySelector("#inspiration-status");
const refresh = document.querySelector("#inspiration-refresh");
const dialog = document.querySelector("#inspiration-dialog");
const expandedImage = document.querySelector("#inspiration-expanded-image");
const expandedCredit = document.querySelector("#inspiration-expanded-credit");
const unsplashUrl = "https://unsplash.com/?utm_source=gateway_city_guide&utm_medium=referral";

function attributionLink(text, url) {
  const link = document.createElement("a");
  link.textContent = text;
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function credit(photo) {
  const paragraph = document.createElement("p");
  paragraph.className = "inspiration-credit";
  paragraph.append("Photo by ", attributionLink(photo.photographerName, photo.photographerProfileUrl),
    " on ", attributionLink("Unsplash", unsplashUrl));
  return paragraph;
}

async function expandPhoto(photo, button) {
  button.disabled = true;
  status.classList.remove("inspiration-status--error");
  status.textContent = "Opening your inspiration photo…";
  try {
    // Register the user's selection before showing the expanded image.
    // The server calls Unsplash's download_location with the private key.
    const response = await fetch("/api/unsplash/dish-inspiration/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downloadLocation: photo.downloadLocation }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "That photo could not be opened. Please try again.");
    }
    const fullSize = new URL(photo.rawUrl);
    // Preserve ixid and hotlink the provider URL, rather than copying the image.
    fullSize.searchParams.set("w", "2400");
    fullSize.searchParams.set("fit", "max");
    fullSize.searchParams.set("auto", "format");
    expandedImage.src = fullSize.toString();
    expandedImage.alt = photo.altText;
    expandedCredit.replaceChildren(...credit(photo).childNodes);
    dialog.showModal();
    status.textContent = "Photo opened. Credits link to the photographer on Unsplash.";
  } catch (error) {
    status.classList.add("inspiration-status--error");
    status.textContent = error instanceof Error ? error.message : "That photo could not be opened. Please try again.";
  } finally {
    button.disabled = false;
  }
}

function photoCard(photo) {
  const card = document.createElement("article");
  card.className = "inspiration-card";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inspiration-image-button";
  button.setAttribute("aria-label", `Expand photo: ${photo.altText}`);
  const image = document.createElement("img");
  image.src = photo.imageUrl;
  image.alt = photo.altText;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    button.disabled = true;
    button.setAttribute("aria-label", "This inspiration image is unavailable");
    button.replaceChildren(document.createTextNode("Image unavailable. Try Refresh Inspiration."));
  }, { once: true });
  button.append(image);
  button.addEventListener("click", () => expandPhoto(photo, button));
  card.append(button, credit(photo));
  return card;
}

async function loadInspiration() {
  refresh.disabled = true;
  grid.setAttribute("aria-busy", "true");
  status.classList.remove("inspiration-status--error");
  status.textContent = "Finding food inspiration on Unsplash…";
  try {
    const response = await fetch("/api/unsplash/dish-inspiration", { cache: "no-store" });
    const photos = await response.json();
    if (!response.ok) throw new Error(photos.error || "Food inspiration could not load. Please try again.");
    if (!Array.isArray(photos)) throw new Error("Food inspiration could not load. Please try again.");
    grid.replaceChildren(...photos.map(photoCard));
    status.textContent = photos.length === 0
      ? "Unsplash has no photos for our city's dish right now. Try refreshing later."
      : photos.length < 6
        ? `Unsplash returned ${photos.length} of up to 6 inspiration photos. Select one to expand.`
        : "Six fresh food inspiration photos from Unsplash. Select one to expand.";
  } catch (error) {
    status.classList.add("inspiration-status--error");
    const message = error instanceof Error ? error.message : "Food inspiration could not load. Please try again.";
    status.textContent = grid.children.length ? `${message} Previously loaded photos are still shown.` : message;
  } finally {
    refresh.disabled = false;
    grid.setAttribute("aria-busy", "false");
  }
}

refresh.addEventListener("click", loadInspiration);
dialog.addEventListener("close", () => expandedImage.removeAttribute("src"));
loadInspiration();
