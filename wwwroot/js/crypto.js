
const keyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

const roomKeyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppRoomKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("roomKeys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});


// Privata ECDH-nycklar lämnar aldrig webbläsaren - sparas bara lokalt i
// IndexedDB, skickas aldrig till servern. Bara den publika halvan av
// nyckelparet laddas upp, vilket är säkert eftersom publika nycklar per
// definition är avsedda att vara öppna.
async function getOrCreateKeyPair() {
    const db = await keyDbPromise;
    const tx = db.transaction("keys", "readonly");
    const existingPrivate = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPrivateKey");
        req.onsuccess = () => res(req.result);
    });
    const existingPublic = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPublicKey");
        req.onsuccess = () => res(req.result);
    });

    if (existingPrivate && existingPublic) {
        const privateKey = await crypto.subtle.importKey(
            "jwk", existingPrivate, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
        );
        return { privateKey, publicJwk: existingPublic, isNew: false };
    }

    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
    );
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const writeTx = db.transaction("keys", "readwrite");
    writeTx.objectStore("keys").put(privateJwk, "ecdhPrivateKey");
    writeTx.objectStore("keys").put(publicJwk, "ecdhPublicKey");

    return { privateKey: keyPair.privateKey, publicJwk, isNew: true };
}

async function ensureKeysRegistered() {
    const result = await getOrCreateKeyPair();

    const checkResponse = await fetch(`/Chat/GetPublicKey?userName=${encodeURIComponent(currentUserName)}`);
    if (!checkResponse.ok) {
        // Servern saknar vår publika nyckel (t.ex. efter databas-rensning) — ladda upp igen
        await fetch("/Chat/SavePublicKey", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `publicKeyJwk=${encodeURIComponent(JSON.stringify(result.publicJwk))}&__RequestVerificationToken=${encodeURIComponent(antiForgeryToken)}`
        });
    }

    return result.privateKey;
}

async function saveRoomKeyLocally(roomId, aesKey) {
    const jwk = await crypto.subtle.exportKey("jwk", aesKey);
    const db = await roomKeyDbPromise;
    const tx = db.transaction("roomKeys", "readwrite");
    tx.objectStore("roomKeys").put(jwk, roomId);
}

async function loadRoomKeyLocally(roomId) {
    const db = await roomKeyDbPromise;
    const tx = db.transaction("roomKeys", "readonly");
    const jwk = await new Promise(res => {
        const req = tx.objectStore("roomKeys").get(roomId);
        req.onsuccess = () => res(req.result);
    });
    if (!jwk) return null;

    return crypto.subtle.importKey(
        "jwk", jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]
    );
}

async function decryptMessage(encryptedText, iv) {
    try {
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToArrayBuffer(iv) },
            currentRoomKey,
            base64ToArrayBuffer(encryptedText)
        );
        return new TextDecoder().decode(decrypted);
    } catch {
        return "[Kunde inte dekryptera meddelandet]";
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}