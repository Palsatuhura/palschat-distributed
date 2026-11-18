/**
 * Shrinks a picture the user chose into a small square JPEG data URL, so it
 * is cheap to store and to send to everyone. Runs in the browser only.
 *
 * - centre-crops to a square, scales to SIZE x SIZE
 * - lowers the quality until it fits MAX_CHARS (the server's limit is 40000)
 */
const SIZE = 128;
const MAX_CHARS = 36000;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export const imageFileToAvatar = (file) =>
  new Promise((resolve, reject) => {
    if (!file || !ALLOWED.includes(file.type)) {
      reject(new Error("Choose a JPEG, PNG or WebP picture."));
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      reject(new Error("That picture is too big. Choose one under 8 MB."));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // JPEG has no transparency
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

        let quality = 0.85;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > MAX_CHARS && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        if (dataUrl.length > MAX_CHARS) {
          reject(new Error("Could not shrink that picture. Try another one."));
          return;
        }
        resolve(dataUrl);
      } catch {
        reject(new Error("Could not read that picture. Try another one."));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that picture. Try another one."));
    };

    img.src = url;
  });
