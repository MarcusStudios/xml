const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const digits = v => String(v ?? '').replace(/\D/g, '');
const brl = n => typeof n === 'number' ? n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
let notes = [], wb = null, rows = [];

function parseNum(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[R$\s]/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c > -1 && d > -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c > -1) s = s.replace(',', '.');
  const n = Number(s); return isNaN(n) ? null : n;
}
const fill = (sel, opts) => sel.innerHTML = opts.map(o => `<option>${esc(o)}</option>`).join('');

const showLoad = msg => { $('loaderText').textContent = msg; $('loader').hidden = false; };
const hideLoad = () => { $('loader').hidden = true; };
const withLoad = async (msg, fn) => {
  showLoad(msg);
  await new Promise(r => setTimeout(r, 30));
  try { await fn(); } finally { hideLoad(); }
};

function getCfopType(cfop) {
  if (['5101','6101','5102','6102','5405','6403','5551','6551'].includes(cfop)) return 'Venda';
  if (['5151','6151','5152','6152','5408','6408','5552','6552','5557','6557'].includes(cfop)) return 'Transferência';
  if (['5910','6910'].includes(cfop)) return 'Bonificação';
  return 'Outros';
}

/* ---- XML: extrai chave, nº e valor total ---- */
function tag(doc, name) { return [...doc.getElementsByTagName('*')].find(e => e.localName === name); }
function readNote(doc, file) {
  let chave = digits(tag(doc, 'chNFe')?.textContent);
  if (chave.length !== 44) {
    const inf = tag(doc, 'infNFe');
    chave = digits(inf?.getAttribute('Id')) || chave;
  }
  
  const cfops = [...doc.getElementsByTagName('CFOP')].map(e => e.textContent);
  const types = [...new Set(cfops.map(getCfopType))];
  const isVenda = cfops.some(c => ['5101', '6101', '5102', '6102', '5405', '6403', '5551', '6551'].includes(c));
  const hasCobr = !!tag(doc, 'cobr');
  const hasTPag90 = [...doc.getElementsByTagName('tPag')].some(t => t.textContent === '90');
  const isSemCobranca = !hasCobr || hasTPag90;
  
  return {
    file, 
    chave, 
    nNF: tag(doc, 'nNF')?.textContent.trim() || '', 
    valor: parseNum(tag(doc, 'vNF')?.textContent),
    cfopsStr: [...new Set(cfops)].join(', '),
    cfopsType: types.join(', '),
    vendaSemCobranca: (isVenda && isSemCobranca) ? 'Sim' : 'Não'
  };
}
$('xmlFiles').onchange = async e => {
  const files = e.target.files;
  if (!files.length) return;
  await withLoad('Lendo arquivos XML...', async () => {
    notes = []; const bad = [];
    for (const f of files) {
      const doc = new DOMParser().parseFromString(await f.text(), 'application/xml');
      if (doc.querySelector('parsererror')) { bad.push(f.name); continue; }
      notes.push(readNote(doc, f.name));
    }
    $('xmlInfo').textContent = `${notes.length} XML(s) lido(s)` + (bad.length ? `; inválido(s): ${bad.join(', ')}` : '') + '.';
    ready();
  });
};

/* ---- Planilha ---- */
function loadRows() { rows = XLSX.utils.sheet_to_json(wb.Sheets[$('sSheet').value], {defval: ''}); }
function refreshCols() {
  loadRows();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  fill($('sKey'), cols); fill($('sVal'), cols); fill($('sCobr'), ['', ...cols]);
  const k = cols.find(c => /chave/i.test(c)), v = cols.find(c => /valor\s*total/i.test(c)) || cols.find(c => /valor|total/i.test(c)), cb = cols.find(c => /cobr|pagamento|forma|dup/i.test(c));
  if (k) $('sKey').value = k; if (v) $('sVal').value = v; if (cb) $('sCobr').value = cb;
  $('shInfo').textContent = `${rows.length} linha(s) na aba.`; ready();
}
$('sheetFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  await withLoad('Lendo planilha...', async () => {
    try {
      const buf = await f.arrayBuffer();
      wb = f.name.toLowerCase().endsWith('.csv') ? XLSX.read(new TextDecoder().decode(buf), {type: 'string'}) : XLSX.read(buf, {type: 'array'});
    } catch (x) { $('err').textContent = 'Não foi possível ler a planilha.'; return; }
    $('err').textContent = ''; fill($('sSheet'), wb.SheetNames); $('cfg').hidden = false; refreshCols();
  });
};
$('sSheet').onchange = refreshCols;
function ready() { $('run').disabled = !(notes.length && wb && $('sKey').value); }

/* ---- Identificação ---- */
let result = [];
$('run').onclick = async () => {
  await withLoad('Cruzando dados...', async () => {
    const kc = $('sKey').value, vc = $('sVal').value, cc = $('sCobr').value, tol = Number($('tol').value) || 0;
    const list = rows.map(r => ({chave: digits(r[kc]), val: parseNum(r[vc]), cobranca: cc ? String(r[cc] ?? '').trim() : ''}));
    const short = list.filter(r => r.chave && r.chave.length !== 44).length;
    $('err').textContent = short ? `Atenção: ${short} chave(s) da planilha não têm 44 dígitos (o Excel pode ter arredondado). Formate a coluna como texto.` : '';
    result = notes.map(n => {
      const hit = n.chave && list.find(r => r.chave === n.chave);
      let st, cls, vp = hit ? hit.val : null, cp = hit ? hit.cobranca : '';
      if (hit) {
        const okValor = n.valor !== null && vp !== null && Math.abs(n.valor - vp) <= tol;
        const divCfop = n.vendaSemCobranca === 'Sim';
        
        if (okValor && !divCfop) {
          st = 'Identificada: chave e valor conferem'; cls = 'ok';
        } else if (okValor && divCfop) {
          st = 'Valor confere, mas há divergência de CFOP (Venda s/ cobrança)'; cls = 'warn';
        } else if (!okValor && !divCfop) {
          st = 'Chave encontrada, valor diverge'; cls = 'warn';
        } else {
          st = 'Chave encontrada, porém valor e CFOP divergem'; cls = 'warn';
        }
      } else {
        const c = n.valor === null ? [] : list.filter(r => r.val !== null && Math.abs(r.val - n.valor) <= tol);
        if (c.length) { st = `Chave não encontrada; valor igual em ${c.length} linha(s): ${c.slice(0, 3).map(r => r.chave || '(sem chave)').join(', ')}${c.length > 3 ? '…' : ''}`; cls = 'warn'; }
        else { st = 'Não identificada na planilha'; cls = 'bad'; }
      }
      return {...n, vp, cp, st, cls};
    });
    const c = k => result.filter(r => r.cls === k).length;
    const divergentes = result.filter(r => r.cls !== 'ok' || r.vendaSemCobranca === 'Sim');
    $('sum').textContent = `${c('ok')} identificada(s) (certas), ${c('warn')} com divergência de valor, ${c('bad')} não encontrada(s). Exibindo apenas divergências (${divergentes.length} notas).`;
    $('tb').innerHTML = divergentes.map(r => {
      const badge = r.vendaSemCobranca === 'Sim' ? `<span class="badge warn">⚠️ Sim</span>` : `<span style="color:var(--muted)">Não</span>`;
      return `<tr><td>${esc(r.file)}</td><td>${esc(r.nNF)}</td><td class="k">${esc(r.chave) || '—'}</td><td class="n">${brl(r.valor)}</td><td class="n">${brl(r.vp)}</td><td>${esc(r.cp) || '—'}</td><td class="k">${esc(r.cfopsStr)}</td><td>${esc(r.cfopsType)}</td><td>${badge}</td><td class="${r.cls}">${esc(r.st)}</td></tr>`;
    }).join('');
    $('out').hidden = false; $('csv').disabled = false;
  });
};
$('csv').onclick = () => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const divergentes = result.filter(r => r.cls !== 'ok' || r.vendaSemCobranca === 'Sim');
  const lines = [['Arquivo', 'Nº NF', 'Chave', 'Valor XML', 'Valor planilha', 'Cobrança na Planilha', 'CFOP(s)', 'Tipo CFOP', 'Venda s/ Cobrança?', 'Resultado'].map(q).join(';')]
    .concat(divergentes.map(r => [r.file, r.nNF, r.chave, r.valor, r.vp, r.cp, r.cfopsStr, r.cfopsType, r.vendaSemCobranca, r.st].map(q).join(';')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], {type: 'text/csv'}));
  a.download = 'identificacao-nf.csv'; a.click();
};
$('sKey').onchange = ready;
