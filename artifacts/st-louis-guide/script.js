const birdButton = document.querySelector("#bird-button");
const birdImage = document.querySelector("#bluebird");
const likeForm = document.querySelector("#like-form");
const likeInput = document.querySelector("#like-input");
const likeList = document.querySelector("#like-list");
const listStatus = document.querySelector("#list-status");

// Keep the visitor's additions in memory for this page view only.
const favorites = [];

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
