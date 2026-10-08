const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const digits = v => String(v ?? '').replace(/\D/g, '');
const brl = n => typeof n === 'number' ? n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
let notes = [], wb = null, rows = [];

const toCents = v => Math.round((v || 0) * 100);
const normalize = (txt) => {
  if (!txt) return '';
  return String(txt)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

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
  
  const dets = [...doc.getElementsByTagName('det')];
  let vProdVenda = 0;
  const cfops = [];
  
  dets.forEach(det => {
    const cfopNode = det.querySelector('CFOP');
    const vProdNode = det.querySelector('vProd');
    if (cfopNode) {
      const cfop = cfopNode.textContent;
      cfops.push(cfop);
      if (getCfopType(cfop) === 'Venda' && vProdNode) {
        vProdVenda += parseNum(vProdNode.textContent) || 0;
      }
    }
  });

  if (cfops.length === 0) {
     cfops.push(...[...doc.getElementsByTagName('CFOP')].map(e => e.textContent));
  }
  
  const types = [...new Set(cfops.map(getCfopType))];
  const isVenda = types.includes('Venda');
  const isMista = isVenda && (types.includes('Bonificação') || types.includes('Transferência'));
  
  const hasCobr = !!tag(doc, 'cobr');
  const hasTPag90 = [...doc.getElementsByTagName('tPag')].some(t => t.textContent === '90');
  const isSemCobranca = !hasCobr || hasTPag90;
  
  return {
    file, 
    chave, 
    nNF: tag(doc, 'nNF')?.textContent.trim() || '', 
    serie: tag(doc, 'serie')?.textContent.trim() || '',
    valor: parseNum(tag(doc, 'vNF')?.textContent),
    vProdVenda,
    cfopsStr: [...new Set(cfops)].join(', '),
    cfopsType: types.join(', '),
    isMista,
    vendaSemCobranca: (isVenda && isSemCobranca) ? 'Sim' : 'Não'
  };
}
$('xmlFiles').onchange = async e => {
  const files = e.target.files;
  if (!files.length) return;
  await withLoad('Lendo arquivos XML...', async () => {
    notes = []; const bad = [];
    for (const f of files) {
      const text = await f.text();
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      if (doc.querySelector('parsererror')) { bad.push(f.name); continue; }
      const parsedNote = readNote(doc, f.name);
      parsedNote.rawXml = text;
      parsedNote.readerIndex = notes.length;
      notes.push(parsedNote);
    }
    const icon = notes.length ? '<i class="ph ph-check-circle" style="color:var(--ok)"></i> ' : '';
    $('xmlInfo').innerHTML = `${icon}${notes.length} XML(s) lido(s)` + (bad.length ? `; inválido(s): ${bad.join(', ')}` : '') + '.';
    $('dzXml').querySelector('span').textContent = `${notes.length} arquivo(s) selecionado(s)`;
    
    if (notes.length > 0) {
      $('xmlReaderList').innerHTML = notes.map((n) => `
        <div class="xml-list-item">
          <div>
            <span class="file-name">${esc(n.file)}</span>
            <span class="file-nNF">NF: ${esc(n.nNF) || 'N/A'} - R$ ${brl(n.valor)}</span>
          </div>
          <button class="sec copy-btn" onclick="openModalFromReader(${n.readerIndex})" title="Ler XML"><i class="ph ph-file-code"></i> Ler</button>
        </div>
      `).join('');
      $('xmlReaderList').hidden = false;
      
      if (notes.length === 1) {
        openModalFromReader(0);
      }
    } else {
      $('xmlReaderList').hidden = true;
    }
    
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
let currentFilter = 'todos';
let currentSearch = '';
let currentSort = { col: 'statusCode', asc: true };

// Helper format functions
const shortKey = k => {
  if (!k) return '—';
  const short = k.length === 44 ? '…' + k.slice(-6) : k;
  return `<span title="${k}">${short}</span> <button class="copy-btn" onclick="navigator.clipboard.writeText('${k}')" title="Copiar chave"><i class="ph ph-copy"></i></button>`;
};

const formatStatus = s => {
  const map = {
    'ok': { l: 'Conferida', c: 'ok', i: 'check-circle' },
    'aprox': { l: 'Aproximada', c: 'aprox', i: 'warning' },
    'aviso': { l: 'Aviso', c: 'aviso', i: 'info' },
    'div': { l: 'Divergente', c: 'div', i: 'warning' },
    'sugestao': { l: 'Sugestão', c: 'aprox', i: 'magnifying-glass' },
    'nao': { l: 'Não encont.', c: 'nao', i: 'x-circle' }
  };
  const d = map[s] || map['nao'];
  return `<span class="status-pill ${d.c}"><i class="ph ph-${d.i}"></i> ${d.l}</span>`;
};

const formatDiff = d => {
  if (d === null || d === undefined) return '—';
  if (Math.abs(d) < 0.01) return '—';
  const val = brl(Math.abs(d));
  if (d > 0) return `<span class="diff pos">+${val}</span>`;
  return `<span class="diff neg">-${val}</span>`;
};

window.setFilter = function(f) {
  currentFilter = f;
  renderResumo();
  renderTabela();
};

window.setSort = function(col) {
  if (!col) return;
  if (currentSort.col === col) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.col = col;
    currentSort.asc = true;
  }
  
  result.sort((a, b) => {
    let va = a[col], vb = b[col];
    if (va === null || va === undefined) va = '';
    if (vb === null || vb === undefined) vb = '';
    
    if (typeof va === 'number' && typeof vb === 'number') {
      return currentSort.asc ? va - vb : vb - va;
    }
    va = String(va).toLowerCase();
    vb = String(vb).toLowerCase();
    if (va < vb) return currentSort.asc ? -1 : 1;
    if (va > vb) return currentSort.asc ? 1 : -1;
    return 0;
  });
  
  renderTabela();
};

function renderResumo() {
  const counts = { todos: result.length, ok: 0, aprox: 0, aviso: 0, div: 0, sugestao: 0, nao: 0 };
  result.forEach(r => { counts[r.statusCode]++; });

  const cardsHtml = `
    <div class="card ${currentFilter === 'todos' ? 'active' : ''}" onclick="setFilter('todos')">
      <div class="val">${counts.todos}</div>
      <div class="lbl"><i class="ph ph-files"></i> Total</div>
    </div>
    <div class="card c-ok ${currentFilter === 'ok' ? 'active' : ''}" onclick="setFilter('ok')">
      <div class="val">${counts.ok}</div>
      <div class="lbl"><i class="ph ph-check-circle"></i> Conferida</div>
    </div>
    <div class="card c-aviso ${currentFilter === 'aviso' ? 'active' : ''}" onclick="setFilter('aviso')">
      <div class="val">${counts.aviso}</div>
      <div class="lbl"><i class="ph ph-info"></i> Aviso</div>
    </div>
    <div class="card c-div ${currentFilter === 'div' ? 'active' : ''}" onclick="setFilter('div')">
      <div class="val">${counts.div}</div>
      <div class="lbl"><i class="ph ph-warning"></i> Divergente</div>
    </div>
    <div class="card c-nao ${currentFilter === 'nao' ? 'active' : ''}" onclick="setFilter('nao')">
      <div class="val">${counts.nao}</div>
      <div class="lbl"><i class="ph ph-x-circle"></i> Não enc.</div>
    </div>
    <div class="card c-aprox ${currentFilter === 'aprox' ? 'active' : ''}" onclick="setFilter('aprox')">
      <div class="val">${counts.aprox + counts.sugestao}</div>
      <div class="lbl"><i class="ph ph-magnifying-glass"></i> Aprox. / Sug.</div>
    </div>
  `;
  $('sumCards').innerHTML = cardsHtml;
}

function renderTabela() {
  let filtered = result.filter(r => {
    if (currentFilter === 'aprox') return r.statusCode === 'aprox' || r.statusCode === 'sugestao';
    if (currentFilter !== 'todos' && r.statusCode !== currentFilter) return false;
    
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      return (r.nNF && r.nNF.toLowerCase().includes(q)) || 
             (r.chave && r.chave.includes(q)) || 
             (r.file && r.file.toLowerCase().includes(q));
    }
    return true;
  });

  $('tCount').textContent = `Exibindo ${filtered.length} de ${result.length}`;

  const activeCols = [
    { label: '', val: r => `<button class="sec copy-btn" onclick="openModal(${r.originalIndex})" title="Ver detalhes da NF"><i class="ph ph-list-magnifying-glass"></i></button>`, sort: null },
    { label: 'Status', val: r => formatStatus(r.statusCode), sort: 'statusCode' },
    { label: 'NF', val: r => `<div>${esc(r.nNF) || '—'}</div><span class="text-sec" title="${esc(r.file)}">${esc(r.file).length > 20 ? esc(r.file).slice(0, 17) + '...' : esc(r.file)}</span>`, sort: 'nNF' },
    { label: 'Chave', val: r => shortKey(r.chave), sort: 'chave' },
    { label: 'Valor XML', val: r => brl(r.valor), isNum: true, sort: 'valor' },
    { label: 'Valor Pl.', val: r => brl(r.vp), isNum: true, sort: 'vp' },
    { label: 'Δ', val: r => formatDiff(r.diff), isNum: true, sort: 'diff' },
    { label: 'Cobrança', val: r => esc(r.cp) || '—', sort: 'cp' },
    { label: 'CFOP(s)', val: r => `<div title="${esc(r.cfopsType)}">${esc(r.cfopsStr)}</div>`, sort: 'cfopsStr' },
    { label: 'Tipo Div.', val: r => r.tipoDiv ? `<span style="color:var(--warn); font-weight:500">${esc(r.tipoDiv)}</span>` : '—', sort: 'tipoDiv' },
    { label: 'Motivos', val: r => `<div class="badges-wrap">${r.motivos.map(m => `<span class="badge ${m.type || 'info'}">${esc(m.msg || m)}</span>`).join('')}</div>` }
  ];

  $('th').innerHTML = `<tr>${activeCols.map(c => `<th onclick="${c.sort ? `setSort('${c.sort}')` : ''}">${c.label} ${currentSort.col === c.sort ? (currentSort.asc ? '▴' : '▾') : ''}</th>`).join('')}</tr>`;
  
  if (filtered.length === 0) {
    $('tb').innerHTML = `<tr><td colspan="${activeCols.length}" style="text-align:center; padding: 32px; color: var(--muted)">Nenhuma nota encontrada para este filtro.</td></tr>`;
    return;
  }

  $('tb').innerHTML = filtered.map(r => {
    return `<tr class="s-${r.statusCode === 'sugestao' ? 'aprox' : r.statusCode}">` + activeCols.map(c => {
      let classes = [];
      if (c.isNum) classes.push('n');
      if (c.sort === 'chave') classes.push('k');
      const clsAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
      return `<td${clsAttr}>${c.val(r)}</td>`;
    }).join('') + `</tr>`;
  }).join('');
}

$('run').onclick = async () => {
  await withLoad('Cruzando dados...', async () => {
    const kc = $('sKey').value, vc = $('sVal').value, cc = $('sCobr').value, numc = $('sNum').value, tol = Number($('tol').value) || 0;
    const isencoesList = $('isencoes').value.split(',').map(s => normalize(s)).filter(s => s);
    const emptyIsIsencao = $('emptyIsIsencao').checked;

    const list = rows.map(r => ({
      chave: digits(r[kc]), 
      val: parseNum(r[vc]), 
      cobranca: cc ? String(r[cc] ?? '').trim() : '',
      nNF: numc ? String(r[numc] ?? '').trim() : ''
    }));
    const short = list.filter(r => r.chave && r.chave.length !== 44).length;
    
    if (short) {
      $('outErr').textContent = `Atenção: ${short} chave(s) da planilha não têm 44 dígitos (o Excel pode ter corrompido). Usaremos Nº + Valor como alternativa, se possível.`;
      $('outErr').hidden = false;
    } else {
      $('outErr').hidden = true;
    }

    result = notes.map(n => {
      let hits = n.chave ? list.filter(r => r.chave === n.chave) : [];
      let matchAlternativo = false;

      if (hits.length === 0 && n.nNF && n.valor !== null && numc) {
        const alts = list.filter(r => {
          if (!r.nNF) return false;
          const numR = digits(r.nNF).replace(/^0+/, '');
          const numN = digits(n.nNF).replace(/^0+/, '');
          return numR && numR === numN;
        });
        if (alts.length > 0) {
           const sumAltsCents = alts.reduce((sum, r) => sum + toCents(r.val), 0);
           const eqVal = n.valor !== null && Math.abs(sumAltsCents - toCents(n.valor)) <= toCents(tol);
           if (eqVal) {
             hits = alts;
             matchAlternativo = true;
           } else {
             const altSingle = alts.find(r => r.val !== null && Math.abs(toCents(r.val) - toCents(n.valor)) <= toCents(tol));
             if (altSingle) {
               hits = [altSingle];
               matchAlternativo = true;
             }
           }
        }
      }

      let vp = null, cp = '';
      let statusCode = '', diff = null, motivos = [], tipoDiv = '';

      if (hits.length > 0) {
        vp = hits.reduce((sum, r) => sum + (r.val || 0), 0);
        
        const cobrancas = hits.map(r => r.cobranca).filter(c => c).map(c => c.trim());
        const uniqueCobrancas = [...new Set(cobrancas)];
        cp = uniqueCobrancas.join(' / ');
        
        if (n.valor !== null && vp !== null) {
          diff = n.valor - vp;
        }

        let isDivValor = false, isDivCfop = false;
        let erros = [];
        let avisos = [];

        const okValor = n.valor !== null && vp !== null && Math.abs(toCents(n.valor) - toCents(vp)) <= toCents(tol);
        if (!okValor) {
          isDivValor = true;
          erros.push('Valor diverge');
        }

        const isIsencao = txt => {
          if (!txt) return emptyIsIsencao;
          const norm = normalize(txt);
          return isencoesList.some(i => norm === i || norm.includes(i));
        };
        
        const hasIsencao = cobrancas.length === 0 ? emptyIsIsencao : cobrancas.some(c => isIsencao(c));
        const hasCobrancaNormal = cobrancas.length > 0 && cobrancas.some(c => !isIsencao(c));
        const hasEmptyCobranca = cobrancas.length === 0 || cobrancas.some(c => !c);

        if (n.isMista) {
          if (hasCobrancaNormal) {
             const okVendaValor = n.vProdVenda > 0 && Math.abs(toCents(vp) - toCents(n.vProdVenda)) <= toCents(tol);
             const compl = okVendaValor ? `(Planilha bate c/ itens venda: ${brl(n.vProdVenda)})` : `(Atenção: Plan=${brl(vp)}, Venda=${brl(n.vProdVenda)})`;
             avisos.push(`Nota mista (Venda+Outros). ${compl}`);
          } else {
             isDivCfop = true;
             erros.push(`Incompatível: Nota mista c/ Venda, mas planilha não aponta cobrança normal (Consta: ${cp || 'Vazio'})`);
          }
        } else {
          if (n.cfopsType.includes('Venda')) {
            if (n.vendaSemCobranca === 'Sim') {
               isDivCfop = true;
               erros.push('Erro no XML: O CFOP é de Venda, mas a nota foi emitida como "Sem Pagamento"');
            } else if (!hasCobrancaNormal) {
               if (hasEmptyCobranca && !emptyIsIsencao) {
                 avisos.push('Aviso: Cobrança não preenchida na planilha (Venda)');
               } else {
                 isDivCfop = true;
                 erros.push(`Incompatível: O XML é de Venda, mas a planilha aponta isenção (Consta: ${cp || 'Vazio'})`);
               }
            }
          } 
          
          if (n.cfopsType.includes('Bonificação') || n.cfopsType.includes('Transferência')) {
            if (hasCobrancaNormal) {
              isDivCfop = true;
              erros.push(`Incompatível: O XML é de ${n.cfopsType.replace(', Venda', '').replace('Venda, ', '')}, mas a planilha aponta cobrança (Consta: ${cp})`);
            }
          }
        }

        if (isDivValor && isDivCfop) tipoDiv = 'Valor e CFOP';
        else if (isDivValor) tipoDiv = 'Valor';
        else if (isDivCfop) tipoDiv = 'CFOP';

        if (erros.length === 0) {
          if (avisos.length > 0) {
            statusCode = 'aviso';
          } else {
            statusCode = matchAlternativo ? 'aprox' : 'ok';
          }
          if (hits.length > 1) motivos.push({msg: `Agrupou ${hits.length} linhas da planilha`, type: 'info'});
        } else {
          statusCode = 'div';
          if (matchAlternativo) erros.push('Match aproximado (Nº+Valor)');
          if (hits.length > 1) erros.push(`Agrupou ${hits.length} linhas da planilha`);
        }

        motivos.push(...erros.map(e => ({msg: e, type: 'err'})));
        motivos.push(...avisos.map(a => ({msg: a, type: 'warn'})));
      } else {
        const c = n.valor === null ? [] : list.filter(r => r.val !== null && Math.abs(toCents(r.val) - toCents(n.valor)) <= toCents(tol));
        if (c.length) { 
          statusCode = 'sugestao'; 
          motivos.push({msg: `Há ${c.length} linha(s) com valor igual na planilha`, type: 'info'});
        }
        else { 
          statusCode = 'nao'; 
          motivos.push({msg: 'Não encontrada', type: 'err'});
        }
      }
      return {...n, vp, cp, statusCode, diff, motivos, tipoDiv};
    });
    
    // Reset filters and configure initial view
    currentFilter = 'todos';
    currentSearch = '';
    $('tSearch').value = '';

    setSort('statusCode');
    renderResumo();
    renderTabela();
    
    $('out').hidden = false; $('csv').disabled = false;
    
    // Scroll smoothly to output
    setTimeout(() => {
      $('out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  });
};

$('tSearch').oninput = (e) => {
  currentSearch = e.target.value;
  renderTabela();
};

$('pdf').onclick = () => {
  if (!window.pdfMake) {
    alert("Erro ao carregar a biblioteca pdfMake.");
    return;
  }
  
  let filtered = result.filter(r => {
    if (currentFilter === 'aprox') return r.statusCode === 'aprox' || r.statusCode === 'sugestao';
    if (currentFilter !== 'todos' && r.statusCode !== currentFilter) return false;
    
    if (currentSearch) {
      const qs = currentSearch.toLowerCase();
      return (r.nNF && r.nNF.toLowerCase().includes(qs)) || 
             (r.chave && r.chave.includes(qs)) || 
             (r.file && r.file.toLowerCase().includes(qs));
    }
    return true;
  });

  const totalXmls = notes.length;
  const totalDivs = result.filter(r => r.statusCode === 'div' || r.statusCode === 'nao').length;
  const totalOks = result.filter(r => r.statusCode === 'ok').length;

  const mapFiltro = {
    'todos': 'Todas as notas',
    'ok': 'Apenas Conferidas',
    'div': 'Apenas Divergentes',
    'nao': 'Não encontradas',
    'aprox': 'Aproximadas / Sugestões'
  };

  const getStatusObj = (status) => {
    if (status === 'ok') return { text: '✓ OK', color: '#1f7a45', bold: true, fontSize: 8 };
    if (status === 'div') return { text: '⚠️ Divergente', color: '#b4521a', bold: true, fontSize: 8 };
    if (status === 'nao') return { text: '✖ Não Enc.', color: '#a8323a', bold: true, fontSize: 8 };
    if (status === 'aprox') return { text: 'Aprox.', color: '#b08605', bold: true, fontSize: 8 };
    if (status === 'aviso') return { text: 'ℹ️ Aviso', color: '#2563eb', bold: true, fontSize: 8 };
    return { text: 'Sugestão', color: '#b08605', bold: true, fontSize: 8 };
  };

  const tableBody = [
    [
      { text: 'Status', style: 'th' },
      { text: 'NF', style: 'th' },
      { text: 'Chave', style: 'th' },
      { text: 'Val XML', style: 'th' },
      { text: 'Val Plan.', style: 'th' },
      { text: 'Diferença', style: 'th' },
      { text: 'CFOP/Op.', style: 'th' },
      { text: 'Cobrança', style: 'th' },
      { text: 'Tipo Div', style: 'th' },
      { text: 'Motivos', style: 'th' }
    ]
  ];

  filtered.forEach(r => {
    const diffVal = r.diff !== null && Math.abs(r.diff) >= 0.01;
    const diffStr = diffVal ? ((r.diff > 0 ? '+' : '-') + brl(Math.abs(r.diff))) : '—';
    const diffColor = diffVal ? '#b4521a' : '#000000';
    const diffBold = diffVal;

    const tipoDivColor = r.tipoDiv ? '#b4521a' : '#000000';
    
    tableBody.push([
      getStatusObj(r.statusCode),
      { text: r.nNF || '—', fontSize: 8 },
      { text: r.chave ? (r.chave.length === 44 ? '...' + r.chave.slice(-6) : r.chave) : '—', fontSize: 8 },
      { text: r.valor !== null ? brl(r.valor) : '', fontSize: 8 },
      { text: r.vp !== null ? brl(r.vp) : '', fontSize: 8 },
      { text: diffStr, color: diffColor, bold: diffBold, fontSize: 8 },
      { text: r.cfopsStr || '—', fontSize: 8 },
      { text: r.cp || '—', fontSize: 8 },
      { text: r.tipoDiv || '—', color: tipoDivColor, bold: r.tipoDiv !== '', fontSize: 8 },
      { text: r.motivos.map(m => m.msg || m).join('\n'), fontSize: 8, color: (r.statusCode === 'div' || r.statusCode === 'nao') ? '#b4521a' : '#000000' }
    ]);
  });

  if (filtered.length === 0) {
    tableBody.push([{ text: 'Nenhuma nota encontrada para o filtro atual.', colSpan: 10, alignment: 'center', margin: [0, 10, 0, 10] }, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
  }

  var docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'A4',
    pageMargins: [ 20, 30, 20, 30 ],
    content: [
      { text: 'Relatório de Cruzamento e Auditoria: XML x Planilha', style: 'header' },
      {
        columns: [
          {
            width: '*',
            text: [
              { text: 'Resumo Geral\n', style: 'subheader' },
              `Total de XMLs Analisados: ${totalXmls}\n`,
              `Notas Conferidas (OK): ${totalOks}\n`,
              { text: `Divergências ou Não Encontradas: ${totalDivs}\n`, color: totalDivs > 0 ? '#b4521a' : '#1f7a45', bold: true }
            ]
          },
          {
            width: '*',
            text: [
              { text: 'Filtro Atual do Relatório\n', style: 'subheader' },
              `Exibindo: ${mapFiltro[currentFilter]}\n`,
              `Total de notas nesta visão: ${filtered.length}\n`
            ],
            alignment: 'right'
          }
        ],
        columnGap: 20,
        margin: [0, 10, 0, 20]
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 50, 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'],
          body: tableBody
        },
        layout: {
          fillColor: function (rowIndex, node, columnIndex) {
            return (rowIndex === 0) ? '#0f6b5c' : ((rowIndex % 2 === 0) ? '#f5f6f4' : null);
          },
          hLineWidth: function (i, node) {
            return (i === 0 || i === node.table.body.length) ? 0 : 0.5;
          },
          vLineWidth: function (i, node) {
            return 0;
          },
          hLineColor: function (i, node) {
            return '#d9dfdb';
          }
        }
      }
    ],
    styles: {
      header: {
        fontSize: 16,
        bold: true,
        color: '#0f6b5c',
        margin: [0, 0, 0, 5]
      },
      subheader: {
        fontSize: 12,
        bold: true,
        margin: [0, 0, 0, 5],
        color: '#1b2421'
      },
      th: {
        bold: true,
        fontSize: 9,
        color: 'white',
        margin: [0, 4, 0, 4]
      }
    },
    defaultStyle: {
      font: 'Roboto',
      fontSize: 10
    }
  };

  pdfMake.createPdf(docDefinition).download('relatorio-auditoria-nf.pdf');
};

$('csv').onclick = () => {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  
  let filtered = result.filter(r => {
    if (currentFilter === 'aprox') return r.statusCode === 'aprox' || r.statusCode === 'sugestao';
    if (currentFilter !== 'todos' && r.statusCode !== currentFilter) return false;
    
    if (currentSearch) {
      const qs = currentSearch.toLowerCase();
      return (r.nNF && r.nNF.toLowerCase().includes(qs)) || 
             (r.chave && r.chave.includes(qs)) || 
             (r.file && r.file.toLowerCase().includes(qs));
    }
    return true;
  });

  const activeCols = [
    { label: 'Status', csv: r => r.statusCode },
    { label: 'NF', csv: r => r.nNF },
    { label: 'Chave no XML', csv: r => r.chave || '—' },
    { label: 'Valor XML', csv: r => r.valor },
    { label: 'Valor planilha', csv: r => r.vp },
    { label: 'Diferenca', csv: r => r.diff },
    { label: 'Cobranca Planilha', csv: r => r.cp },
    { label: 'CFOP(s)', csv: r => r.cfopsStr },
    { label: 'Tipo CFOP', csv: r => r.cfopsType },
    { label: 'Venda s/ Cobranca?', csv: r => r.vendaSemCobranca },
    { label: 'Tipo Divergencia', csv: r => r.tipoDiv },
    { label: 'Motivos', csv: r => r.motivos.map(m => m.msg || m).join(' | ') }
  ];

  const lines = [activeCols.map(c => q(c.label)).join(';')]
    .concat(filtered.map(r => activeCols.map(c => q(c.csv(r))).join(';')));
    
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\n')], {type: 'text/csv'}));
  a.download = 'identificacao-nf.csv'; a.click();
};

$('sKey').onchange = ready;

window.switchModalTab = function(tab) {
  const isResumo = tab === 'resumo';
  document.querySelectorAll('.tab-btn').forEach(b => {
    if (b.textContent.toLowerCase().includes(tab === 'resumo' ? 'resumo' : 'xml')) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });
  document.getElementById('modalBodyResumo').hidden = !isResumo;
  document.getElementById('modalBodyArvore').hidden = isResumo;
};

function buildXmlTree(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    return text ? `<span class="xml-val">${esc(text)}</span>` : '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  
  let html = `<div class="xml-node">`;
  const name = node.localName;
  
  const children = [...node.childNodes].filter(c => c.nodeType === Node.ELEMENT_NODE || (c.nodeType === Node.TEXT_NODE && c.textContent.trim()));
  const isLeaf = children.length === 1 && children[0].nodeType === Node.TEXT_NODE;
  
  if (isLeaf) {
    html += `<span class="xml-tag">&lt;${name}&gt;</span>`;
    html += `<span class="xml-val">${esc(children[0].textContent.trim())}</span>`;
    html += `<span class="xml-tag">&lt;/${name}&gt;</span>`;
  } else if (children.length === 0) {
    html += `<span class="xml-tag">&lt;${name}/&gt;</span>`;
  } else {
    html += `<div class="xml-tag-open" data-name="${name}" onclick="this.parentElement.classList.toggle('collapsed')">
               <i class="ph ph-caret-down"></i>&lt;${name}&gt;
             </div>`;
    html += `<div class="xml-children">`;
    children.forEach(child => {
      html += buildXmlTree(child);
    });
    html += `</div>`;
    html += `<div class="xml-tag-close">&lt;/${name}&gt;</div>`;
  }
  html += `</div>`;
  return html;
}

function showModalWithNote(note) {
  if (!note || !note.rawXml) return;
  
  const doc = new DOMParser().parseFromString(note.rawXml, 'application/xml');
  const t = name => { const e = [...doc.getElementsByTagName('*')].find(el => el.localName === name); return e ? e.textContent : ''; };
  
  const emitNome = t('xNome');
  const emitCNPJ = t('CNPJ');
  const emitIE = [...doc.getElementsByTagName('emit')][0]?.querySelector('IE')?.textContent || '';
  const destElement = [...doc.getElementsByTagName('dest')][0];
  const destNome = destElement?.querySelector('xNome')?.textContent || '';
  const destCNPJ = destElement?.querySelector('CNPJ')?.textContent || destElement?.querySelector('CPF')?.textContent || '';
  const destIE = destElement?.querySelector('IE')?.textContent || '';
  const natOp = t('natOp');
  const dhEmi = t('dhEmi');
  const dataEmi = dhEmi ? new Date(dhEmi).toLocaleDateString('pt-BR') : '';
  
  const vNF = parseNum(t('vNF'));
  const vFrete = parseNum(t('vFrete'));
  const vSeg = parseNum(t('vSeg'));
  const vDesc = parseNum(t('vDesc'));
  const vOutro = parseNum(t('vOutro'));
  const vIPI = parseNum(t('vIPI'));
  const vBC = parseNum(t('vBC'));
  const vICMS = parseNum(t('vICMS'));
  const vProdTotal = parseNum(t('vProd'));
  
  const dets = [...doc.getElementsByTagName('det')];
  
  const itemsHtml = dets.map(det => {
    const prod = det.querySelector('prod');
    const cProd = prod?.querySelector('cProd')?.textContent || '';
    const xProd = prod?.querySelector('xProd')?.textContent || '';
    const ncm = prod?.querySelector('NCM')?.textContent || '';
    const cfop = prod?.querySelector('CFOP')?.textContent || '';
    const uCom = prod?.querySelector('uCom')?.textContent || '';
    const qCom = parseNum(prod?.querySelector('qCom')?.textContent);
    const vUnCom = parseNum(prod?.querySelector('vUnCom')?.textContent);
    const vProdItem = parseNum(prod?.querySelector('vProd')?.textContent);
    return `<tr>
      <td>${esc(cProd)}</td>
      <td>${esc(xProd)}</td>
      <td>${esc(ncm)}</td>
      <td>${esc(cfop)}</td>
      <td>${esc(uCom)}</td>
      <td class="n">${qCom}</td>
      <td class="n">${brl(vUnCom)}</td>
      <td class="n">${brl(vProdItem)}</td>
    </tr>`;
  }).join('');
  
  let html = `
    <div class="danfe-wrapper">
      <div class="danfe-header">
        <div class="danfe-emitente">
          <span style="font-size:12px; font-weight:bold; margin-bottom:4px;">${esc(emitNome)}</span>
          <span style="font-size:10px;">CNPJ: ${esc(emitCNPJ)}</span>
          <span style="font-size:10px;">IE: ${esc(emitIE)}</span>
        </div>
        <div class="danfe-title">
          <h3>DANFE</h3>
          <span>Documento Auxiliar da<br>Nota Fiscal Eletrônica</span>
        </div>
        <div class="danfe-chave">
          <label style="font-size:8px; text-transform:uppercase;">Chave de Acesso</label>
          <span style="font-size:11px; font-weight:bold;">${esc(note.chave)}</span>
        </div>
      </div>

      <div class="danfe-row">
        <div class="danfe-col" style="flex: 4"><label>NATUREZA DA OPERAÇÃO</label><span>${esc(natOp)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>NÚMERO</label><span>${esc(note.nNF)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>SÉRIE</label><span>${esc(note.serie)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>EMISSÃO</label><span>${dataEmi}</span></div>
      </div>

      <div class="danfe-section-title">DESTINATÁRIO / REMETENTE</div>
      <div class="danfe-row">
        <div class="danfe-col" style="flex: 3"><label>NOME / RAZÃO SOCIAL</label><span>${esc(destNome)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>CNPJ / CPF</label><span>${esc(destCNPJ)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>INSCRIÇÃO ESTADUAL</label><span>${esc(destIE)}</span></div>
      </div>

      <div class="danfe-section-title">CÁLCULO DO IMPOSTO</div>
      <div class="danfe-row">
        <div class="danfe-col" style="flex: 1"><label>BASE DE CÁLCULO DO ICMS</label><span>${brl(vBC)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR DO ICMS</label><span>${brl(vICMS)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR DO FRETE</label><span>${brl(vFrete)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR DO SEGURO</label><span>${brl(vSeg)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>DESCONTO</label><span>${brl(vDesc)}</span></div>
      </div>
      <div class="danfe-row">
        <div class="danfe-col" style="flex: 1"><label>OUTRAS DESPESAS</label><span>${brl(vOutro)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR DO IPI</label><span>${brl(vIPI)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR TOTAL DOS PRODUTOS</label><span>${brl(vProdTotal)}</span></div>
        <div class="danfe-col" style="flex: 1"><label>VALOR TOTAL DA NOTA</label><span>${brl(vNF)}</span></div>
      </div>

      <div class="danfe-section-title">DADOS DOS PRODUTOS / SERVIÇOS</div>
      <table class="danfe-table">
        <thead>
          <tr>
            <th>CÓDIGO</th>
            <th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th>
            <th>NCM</th>
            <th>CFOP</th>
            <th>UNID</th>
            <th class="n">QTD</th>
            <th class="n">VLR. UNIT</th>
            <th class="n">VLR. TOTAL</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
    
    <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
       <button class="btn" onclick="printDanfe()" style="padding: 8px 16px;"><i class="ph ph-printer"></i> Imprimir DANFE</button>
    </div>
  `;
  
  document.getElementById('modalTitle').textContent = `Nota Fiscal: ${esc(note.nNF)}`;
  document.getElementById('modalBodyResumo').innerHTML = html;
  
  // Build and insert complete XML Tree
  const treeHtml = buildXmlTree(doc.documentElement);
  document.getElementById('modalBodyArvore').innerHTML = treeHtml;
  
  switchModalTab('resumo');
  document.getElementById('xmlModal').hidden = false;
};

window.openModal = function(idx) {
  const note = result.find(r => r.originalIndex === idx);
  showModalWithNote(note);
};

window.openModalFromReader = function(idx) {
  const note = notes[idx];
  showModalWithNote(note);
};

window.printDanfe = function() {
  const content = document.getElementById('modalBodyResumo').innerHTML;
  const win = window.open('', '_blank');
  win.document.write(`
    <html>
      <head>
        <title>DANFE</title>
        <style>
          body { margin: 0; padding: 20px; font-family: 'Arial', sans-serif; }
          .danfe-wrapper { border: 1px solid #000; padding: 4px; color: #000; background: #fff; line-height: 1.2; border-radius: 4px; }
          .danfe-header { display: flex; border: 1px solid #000; margin-bottom: 4px; }
          .danfe-emitente { flex: 2; padding: 6px; border-right: 1px solid #000; display: flex; flex-direction: column; justify-content: center; text-align: center; }
          .danfe-title { flex: 1; padding: 6px; border-right: 1px solid #000; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
          .danfe-title h3 { font-size: 18px; margin: 0; font-weight: bold; letter-spacing: 2px;}
          .danfe-title span { font-size: 9px; font-weight: bold; text-transform: uppercase;}
          .danfe-chave { flex: 2; padding: 6px; display: flex; flex-direction: column; justify-content: center; align-items: center; }
          .danfe-section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; margin-top: 8px; margin-bottom: 2px; }
          .danfe-row { display: flex; border: 1px solid #000; margin-bottom: 4px; }
          .danfe-col { padding: 2px 6px; border-right: 1px solid #000; display: flex; flex-direction: column; overflow: hidden; }
          .danfe-col:last-child { border-right: none; }
          .danfe-col label { font-size: 8px; text-transform: uppercase; margin-bottom: 2px; color: #000; font-family: 'Arial', sans-serif;}
          .danfe-col span { font-size: 11px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'Arial', sans-serif;}
          .danfe-table { width: 100%; border-collapse: collapse; border: 1px solid #000; margin-top: 4px; }
          .danfe-table th, .danfe-table td { border: 1px solid #000; padding: 4px; font-size: 10px; font-family: 'Arial', sans-serif;}
          .danfe-table th { text-align: left; font-size: 8px; font-weight: normal; color: #000;}
          .danfe-table td.n, .danfe-table th.n { text-align: right; }
          button { display: none !important; }
          @media print {
             @page { margin: 10mm; }
          }
        </style>
      </head>
      <body onload="setTimeout(function(){ window.print(); window.close(); }, 500);">
        ${content}
      </body>
    </html>
  `);
  win.document.close();
};
