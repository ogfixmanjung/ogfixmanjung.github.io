/* Pilih mod simpanan: cloud (Firebase) jika config diisi, jika tidak tempatan. */
window.DB = window.FIREBASE_CONFIG ? window.CloudDB : window.LocalDB;
