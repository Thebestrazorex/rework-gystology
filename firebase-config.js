// =========================================================
// НАЛАШТУВАННЯ ПІДКЛЮЧЕННЯ ДО FIREBASE
// =========================================================
// Тут потрібно вставити config-об'єкт вашого власного
// Firebase-проєкту. Детальна інструкція — у файлі README.md,
// розділ "Крок 1-4".
//
// Це НЕ секретні дані — їх нормально тримати у відкритому
// коді (безпека забезпечується правилами Firestore, а не
// приховуванням цих значень).
// =========================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBYaNdNyaUsi48esbhETzRtSY5s-oP4WQQ",
  authDomain: "rework-gystology.firebaseapp.com",
  projectId: "rework-gystology",
  storageBucket: "rework-gystology.firebasestorage.app",
  messagingSenderId: "122745110566",
  appId: "1:122745110566:web:36d1db3febf2bff97766e7"
};

// Технічна пошта адміністратора у Firebase Authentication.
// Це НЕ справжня поштова скринька — просто унікальний
// ідентифікатор облікового запису адміністратора.
// Змінювати не обов'язково, головне — щоб цей рядок
// співпадав з тим, що ви створите на кроці 3 інструкції,
// і з правилами у firestore.rules.
export const ADMIN_EMAIL = "admin@vidrobitka.internal";
