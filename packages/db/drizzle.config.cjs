// Config ini sengaja memakai extension .cjs (CommonJS) karena drizzle-kit
// memuat file config lewat `require()`. Di package yang "type": "module",
// file .ts/.mts dimuat sebagai ESM sehingga `require` tidak tersedia.
//
// Schema memakai path RELATIF: drizzle-kit mencocokkan schema dengan glob,
// dan glob tidak bisa menangani separator path Windows ("\") di path absolut.
module.exports = {
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
