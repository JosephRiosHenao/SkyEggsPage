// Uso: node src/hash-password.js            (pide la contraseña)
//      node src/hash-password.js "clave"    (la toma del argumento)
// Imprime el valor para ADMIN_PASSWORD_HASH del .env.
import { hashPassword } from "./auth.js";
import { createInterface } from "node:readline";

const fromArg = process.argv[2];
if (fromArg) {
  console.log(hashPassword(fromArg));
} else {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.question("Contraseña del panel (mínimo 12 caracteres): ", (pw) => {
    rl.close();
    if (pw.length < 12) {
      console.error("Muy corta: usa al menos 12 caracteres.");
      process.exit(1);
    }
    console.log(hashPassword(pw));
  });
}
