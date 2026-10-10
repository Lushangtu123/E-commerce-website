module.exports = async function awaitGate(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 30000);
    })]);
  } finally {
    clearTimeout(timer);
  }
};
