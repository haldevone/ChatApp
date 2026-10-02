
// IndexedDB används för att lagra ECDH-nyckelparet lokalt i webbläsaren.
const keyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

// Separat IndexedDB-databas för att lagra AES-nycklar för rum lokalt i webbläsaren.
const roomKeyDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("ChatAppRoomKeys", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("roomKeys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});


// Privata ECDH-nycklar lämnar aldrig webbläsaren - sparas bara lokalt i
// IndexedDB, skickas aldrig till servern. Bara den publika halvan av
// nyckelparet laddas upp.
// Om nyckelparet inte finns, generera ett nytt och spara det lokalt.
async function getOrCreateKeyPair() {
    const db = await keyDbPromise;
    const tx = db.transaction("keys", "readonly");

// Kontrollera om privata nyckeln redan finns i IndexedDB
    const existingPrivate = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPrivateKey");
        req.onsuccess = () => res(req.result);
    });

// Kontrollera om den publika nyckeln redan finns i IndexedDB
    const existingPublic = await new Promise(res => {
        const req = tx.objectStore("keys").get("ecdhPublicKey");
        req.onsuccess = () => res(req.result);
    });

    if (existingPrivate && existingPublic) {
// Om nyckelparet redan finns, importera den privata nyckeln och returnera den tillsammans med den publika JWK
        const privateKey = await crypto.subtle.importKey(
            "jwk", existingPrivate, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
        );
        return { privateKey, publicJwk: existingPublic, isNew: false };
    }

// Om nyckelparet inte finns, generera ett nytt och spara det lokalt
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]
    );

// Exportera nycklarna som JWK (JSON Web Key) för lagring i IndexedDB
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

    const writeTx = db.transaction("keys", "readwrite");
    writeTx.objectStore("keys").put(privateJwk, "ecdhPrivateKey");
    writeTx.objectStore("keys").put(publicJwk, "ecdhPublicKey");

    return { privateKey: keyPair.privateKey, publicJwk, isNew: true };
}


// Kontrollera med servern om vår publika nyckel redan är registrerad. Om inte, ladda upp den.
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

// Lagra AES-nyckeln för ett rum lokalt i IndexedDB
async function saveRoomKeyLocally(roomId, aesKey) {
    const jwk = await crypto.subtle.exportKey("jwk", aesKey);
    const db = await roomKeyDbPromise;
    const tx = db.transaction("roomKeys", "readwrite");
    tx.objectStore("roomKeys").put(jwk, roomId);
}

// Hämta AES-nyckeln för ett rum från IndexedDB
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

// Dekryptera ett meddelande med den AES-nyckel som är lagrad i currentRoomKey
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

// Konvertera ArrayBuffer till Base64-sträng, och vice versa, för att kunna skicka binär data som text över nätverket.
// Då kryptering med AES-GCM ger binär data, behöver vi konvertera den till Base64 för att kunna skicka den som text 
// med Json eller via SignalR. När vi tar emot meddelandet, konverterar vi tillbaka från 
//Base64 till ArrayBuffer för att kunna dekryptera det.
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