// tests/duo.test.mjs — prova o parsing/validacao do ?duo=id1,id2 sem navegador.
//
//   node tests/duo.test.mjs
import { lerDuo, validarDuo } from "../ui/duo-parametros.mjs";

let ok = 0, falhas = 0;
const check = (cond, msg) => {
  if (cond) { ok++; console.log(`   ok    ${msg}`); }
  else { falhas++; console.log(`   FALHA ${msg}`); }
};
const secao = (t) => console.log(`\n== ${t}`);

const perfis = {
  systems: [
    { id: "win101", name: "Windows 1.01" },
    { id: "win203", name: "Windows 2.03" },
    { id: "msdos622", name: "MS-DOS 6.22" },
  ],
};

secao("leitura do ?duo=");
{
  const r = lerDuo("?duo=win101,win203");
  check(r.erro === null, "dois ids validos nao geram erro");
  check(r.ids.join("|") === "win101|win203", "ids na ordem do link");
}
{
  const r = lerDuo("?duo=win101%2Cwin203");
  check(r.ids.join("|") === "win101|win203", "virgula codificada (%2C) tambem funciona");
}
{
  const r = lerDuo("?duo=win101,+win203+&system=msdos622");
  check(r.ids.join("|") === "win101|win203", "espacos em volta sao removidos e outros parametros nao atrapalham");
}
{
  const r = lerDuo("?duo=WIN101,Win203");
  check(r.ids.join("|") === "win101|win203", "ids sao normalizados para minusculas");
}
{
  const r = lerDuo("?duo=win101,win203,msdos622");
  check(!!r.erro, "tres sistemas sao recusados");
  check(/exatamente dois/.test(r.erro), "mensagem explica que sao exatamente dois");
}
{
  const r = lerDuo("?duo=win101");
  check(!!r.erro, "um sistema so' e' recusado");
}
{
  const r = lerDuo("?duo=win101,win203,");
  check(!!r.erro, "virgula sobrando e' recusada");
}
{
  const r = lerDuo("?duo=");
  check(!!r.erro, "?duo= vazio e' recusado");
}
{
  const r = lerDuo("?system=msdos622");
  check(!!r.erro, "sem ?duo= e' recusado");
}

secao("validacao contra profiles.json");
{
  const r = validarDuo(["win101", "win203"], perfis.systems);
  check(r.erro === null, "dois ids existentes passam");
  check(r.sistemas.map((s) => s.name).join(" x ") === "Windows 1.01 x Windows 2.03", "devolve os objetos na ordem");
}
{
  const r = validarDuo(["win101", "naoexiste"], perfis.systems);
  check(!!r.erro, "id desconhecido e' recusado");
  check(/naoexiste/.test(r.erro), "a mensagem diz qual id nao existe");
}
{
  const r = validarDuo(["win101", "win101"], perfis.systems);
  check(r.erro === null && r.sistemas.length === 2, "o mesmo sistema dos dois lados e' permitido");
}
{
  const r = validarDuo(["win101", "win203"], []);
  check(!!r.erro, "lista de perfis vazia recusa os ids");
}

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
