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
    const icon = notes.length ? '<i class="ph ph-check-circle" style="color:var(--ok)"></i> ' : '';
    $('xmlInfo').innerHTML = `${icon}${notes.length} XML(s) lido(s)` + (bad.length ? `; inválido(s): ${bad.join(', ')}` : '') + '.';
    $('dzXml').querySelector('span').textContent = `${notes.length} arquivo(s) selecionado(s)`;
    ready();
  });
};

function setupDropzone(id, inputId) {
  const dz = $(id), inp = $(inputId);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('dragover'); };
  dz.ondragleave = e => { e.preventDefault(); dz.classList.remove('dragover'); };
  dz.ondrop = e => {
    e.preventDefault(); dz.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      inp.files = e.dataTransfer.files;
      inp.dispatchEvent(new Event('change'));
    }
  };
}
setupDropzone('dzXml', 'xmlFiles');
setupDropzone('dzSheet', 'sheetFile');

/* ---- Planilha ---- */
function loadRows() { rows = XLSX.utils.sheet_to_json(wb.Sheets[$('sSheet').value], {defval: ''}); }
function refreshCols() {
  loadRows();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  fill($('sKey'), cols); fill($('sVal'), cols); fill($('sNum'), ['', ...cols]); fill($('sCobr'), ['', ...cols]);
  const k = cols.find(c => /chave/i.test(c)), v = cols.find(c => /valor\s*total/i.test(c)) || cols.find(c => /valor|total/i.test(c)), cb = cols.find(c => /cobr|pagamento|forma|dup/i.test(c));
  const nu = cols.find(c => /n[úu]mero|n[ºo]\s*nf|nf/i.test(c));
  if (k) $('sKey').value = k; if (v) $('sVal').value = v; if (nu) $('sNum').value = nu; if (cb) $('sCobr').value = cb;
  $('shInfo').textContent = `${rows.length} linha(s) na aba.`; ready();
}
$('sheetFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  await withLoad('Lendo planilha...', async () => {
    try {
      const buf = await f.arrayBuffer();
      wb = f.name.toLowerCase().endsWith('.csv') ? XLSX.read(new TextDecoder().decode(buf), {type: 'string'}) : XLSX.read(buf, {type: 'array'});
    } catch (x) { $('err').innerHTML = '<i class="ph ph-warning"></i> Não foi possível ler a planilha.'; return; }
    $('err').textContent = ''; fill($('sSheet'), wb.SheetNames); $('cfg').hidden = false; refreshCols();
    $('dzSheet').querySelector('span').textContent = f.name;
    $('shInfo').innerHTML = `<i class="ph ph-check-circle" style="color:var(--ok)"></i> Planilha carregada com sucesso.`;
  });
};
$('sSheet').onchange = refreshCols;
function ready() { $('run').disabled = !(notes.length && wb && $('sKey').value); }

/* ---- Identificação ---- */
let result = [];
$('run').onclick = async () => {
  await withLoad('Cruzando dados...', async () => {
    const kc = $('sKey').value, vc = $('sVal').value, cc = $('sCobr').value, numc = $('sNum').value, tol = Number($('tol').value) || 0;
    const list = rows.map(r => ({
      chave: digits(r[kc]), 
      val: parseNum(r[vc]), 
      cobranca: cc ? String(r[cc] ?? '').trim() : '',
      nNF: numc ? String(r[numc] ?? '').trim() : ''
    }));
    const short = list.filter(r => r.chave && r.chave.length !== 44).length;
    $('err').textContent = short ? `Atenção: ${short} chave(s) da planilha não têm 44 dígitos (o Excel pode ter corrompido). Usaremos Nº + Valor como alternativa, se possível.` : '';
    result = notes.map(n => {
      let hit = n.chave && list.find(r => r.chave === n.chave);
      let matchAlternativo = false;

      // 3. Fallback: Casamento por Nº da NF + Valor (Fase 3)
      if (!hit && n.nNF && n.valor !== null && numc) {
        const alt = list.find(r => {
           // Checa se o número consta na coluna e o valor bate (com tolerância)
           const eqNum = r.nNF && r.nNF.includes(n.nNF);
           const eqVal = r.val !== null && Math.abs(r.val - n.valor) <= tol;
           return eqNum && eqVal;
        });
        if (alt) {
           hit = alt;
           matchAlternativo = true;
        }
      }

      let st, cls, vp = hit ? hit.val : null, cp = hit ? hit.cobranca : '';
      let isDivValor = false, isDivCfop = false;
      let motivos = [];

      if (hit) {
        // 1. Checagem de Valor
        const okValor = n.valor !== null && vp !== null && Math.abs(n.valor - vp) <= tol;
        if (!okValor) {
          isDivValor = true;
          motivos.push('Valor diverge');
        }

        // 2. Validação Cruzada: CFOP x Cobrança (Fase 1)
        const cpStr = String(cp).toLowerCase().trim();
        const isSemCobrancaTxt = !cpStr || cpStr === 'sem cobrança' || cpStr.includes('bonifica') || cpStr.includes('transf');
        
        if (n.cfopsType.includes('Venda')) {
          if (n.vendaSemCobranca === 'Sim') {
             isDivCfop = true;
             motivos.push('XML Venda sem cobrança (ou tPag=90)');
          } else if (isSemCobrancaTxt) {
             isDivCfop = true;
             motivos.push(`Venda, mas planilha informa: ${cp || 'Vazio'}`);
          }
        } else if (n.cfopsType.includes('Bonificação')) {
          if (!isSemCobrancaTxt) {
            isDivCfop = true;
            motivos.push(`Bonificação com cobrança na planilha (${cp})`);
          }
        } else if (n.cfopsType.includes('Transferência')) {
          if (!isSemCobrancaTxt) {
            isDivCfop = true;
            motivos.push(`Transferência com cobrança na planilha (${cp})`);
          }
        }

        if (motivos.length === 0) {
          st = matchAlternativo ? 'Identificada por Nº+Valor: sem divergências' : 'Identificada: sem divergências'; 
          cls = matchAlternativo ? 'warn' : 'ok';
        } else {
          st = motivos.join(' | ') + (matchAlternativo ? ' (Match aproximado)' : ''); 
          cls = 'warn';
        }
      } else {
        isDivValor = true;
        const c = n.valor === null ? [] : list.filter(r => r.val !== null && Math.abs(r.val - n.valor) <= tol);
        if (c.length) { st = `Chave não encontrada, mas há valor igual em ${c.length} linha(s)`; cls = 'warn'; }
        else { st = 'Não identificada na planilha'; cls = 'bad'; }
      }
      return {...n, vp, cp, st, cls, isDivValor, isDivCfop};
    });
    const c = k => result.filter(r => r.cls === k).length;
    
    const filtro = $('sFiltro').value;
    const divergentes = result.filter(r => {
      if (filtro === 'todas') return true;
      if (filtro === 'cfop') return r.isDivCfop;
      if (filtro === 'valor') return r.isDivValor;
      return r.isDivValor || r.isDivCfop;
    });

    const filtroTexto = {
      'ambas': 'Exibindo apenas notas com divergências (Valor ou CFOP).',
      'cfop': 'Exibindo apenas notas com divergências de CFOP.',
      'valor': 'Exibindo apenas notas com divergências de Valor.',
      'todas': 'Exibindo todas as notas (sem filtros).'
    }[filtro];

    $('sum').innerHTML = `<strong>Resumo:</strong> ${c('ok')} certas, ${c('warn')} com divergência, ${c('bad')} não encontradas.<br><span style="color:var(--warn);margin-top:4px;display:block"><i class="ph ph-funnel"></i> ${filtroTexto} (${divergentes.length} notas na tabela)</span>`;
    
    const activeCols = [
      { label: 'Arquivo XML', show: true, val: r => esc(r.file) },
      { label: 'Nº NF', show: true, val: r => esc(r.nNF) },
      { label: 'Chave no XML', show: true, val: r => esc(r.chave) || '—', isKey: true },
      { label: 'Valor XML', show: filtro !== 'cfop', val: r => brl(r.valor), isNum: true },
      { label: 'Valor planilha', show: filtro !== 'cfop', val: r => brl(r.vp), isNum: true },
      { label: 'Cobrança Planilha', show: filtro !== 'valor', val: r => esc(r.cp) || '—' },
      { label: 'CFOP(s)', show: filtro !== 'valor', val: r => esc(r.cfopsStr), isKey: true },
      { label: 'Tipo CFOP', show: filtro !== 'valor', val: r => esc(r.cfopsType) },
      { label: 'Venda s/ Cobrança?', show: filtro !== 'valor', val: r => r.vendaSemCobranca === 'Sim' ? `<span class="badge warn">⚠️ Sim</span>` : `<span style="color:var(--muted)">Não</span>` },
      { label: 'Resultado', show: true, val: r => esc(r.st), isResult: true }
    ].filter(c => c.show);

    $('th').innerHTML = `<tr>${activeCols.map(c => `<th>${c.label}</th>`).join('')}</tr>`;
    
    $('tb').innerHTML = divergentes.map(r => {
      return `<tr>` + activeCols.map(c => {
        let classes = [];
        if (c.isNum) classes.push('n');
        if (c.isKey) classes.push('k');
        if (c.isResult) classes.push(r.cls);
        const clsAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
        return `<td${clsAttr}>${c.val(r)}</td>`;
      }).join('') + `</tr>`;
    }).join('');
    
    $('out').hidden = false; $('csv').disabled = false;
  });
};
$('csv').onclick = () => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  
  const filtro = $('sFiltro').value;
  const divergentes = result.filter(r => {
    if (filtro === 'todas') return true;
    if (filtro === 'cfop') return r.isDivCfop;
    if (filtro === 'valor') return r.isDivValor;
    return r.isDivValor || r.isDivCfop;
  });

  const activeCols = [
    { label: 'Arquivo XML', show: true, val: r => r.file },
    { label: 'Nº NF', show: true, val: r => r.nNF },
    { label: 'Chave no XML', show: true, val: r => r.chave || '—' },
    { label: 'Valor XML', show: filtro !== 'cfop', val: r => r.valor },
    { label: 'Valor planilha', show: filtro !== 'cfop', val: r => r.vp },
    { label: 'Cobrança Planilha', show: filtro !== 'valor', val: r => r.cp },
    { label: 'CFOP(s)', show: filtro !== 'valor', val: r => r.cfopsStr },
    { label: 'Tipo CFOP', show: filtro !== 'valor', val: r => r.cfopsType },
    { label: 'Venda s/ Cobrança?', show: filtro !== 'valor', val: r => r.vendaSemCobranca },
    { label: 'Resultado', show: true, val: r => r.st }
  ].filter(c => c.show);

  const lines = [activeCols.map(c => q(c.label)).join(';')]
    .concat(divergentes.map(r => activeCols.map(c => q(c.val(r))).join(';')));
    
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], {type: 'text/csv'}));
  a.download = 'identificacao-nf.csv'; a.click();
};
$('sKey').onchange = ready;
