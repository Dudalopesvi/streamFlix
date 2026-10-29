const $ = (id) => document.getElementById(id);

let usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
let filtroAdmin = ''; // administrador pesquisado ('' = todos)

// evita que um título com HTML quebre a página
function esc(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

// fetch que manda o token. Se o servidor recusar o token, faz logout.
async function api(url, opcoes = {}) {
  const token = localStorage.getItem('token');
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  const resp = await fetch(url, { ...opcoes, headers });
  if (resp.status === 401 && token) sair();
  return resp;
}

function sair() {
  localStorage.clear();
  window.location.href = '/';
}

function limparErros() {
  document.querySelectorAll('.erro').forEach((el) => (el.textContent = ''));
}

function mensagem(texto) {
  $('vitrine').innerHTML = `<p class="mensagem">${esc(texto)}</p>`;
}

// ---------------------------------------------------------------------------
// CABEÇALHO
// ---------------------------------------------------------------------------
function atualizarTela() {
  const logado = usuario !== null;
  const admin = logado && usuario.tipo === 'administrador';

  $('nomeUsuario').textContent = logado ? usuario.nome : '@StreamFlix';
  $('btnLogin').textContent = logado ? 'Logout' : 'Login';

  if (logado && usuario.imagem_usuario) {
    const foto = usuario.imagem_usuario;
    $('fotoPerfil').src = /^(https?:)?\//.test(foto) ? foto : 'uploads/perfil/' + foto;
  }

  // visitante: parece desabilitado mas ainda recebe o clique (abre o login)
  $('btnVerPerfil').disabled = logado && !admin;
  $('btnVerPerfil').classList.toggle('desabilitado', !admin);

  $('inputBusca').placeholder = logado
    ? 'Digite o nome do administrador'
    : 'Digite o nome do administrador... ex: @curador1';
}

// ---------------------------------------------------------------------------
// LEITOR DE JSON
// ---------------------------------------------------------------------------
async function lerJson(resp) {
  const texto = await resp.text();
  try { return JSON.parse(texto); }
  catch { return { erro: `Erro ${resp.status} no servidor.` }; }
}


// ---------------------------------------------------------------------------
// GALERIA
// ---------------------------------------------------------------------------
async function carregarVitrine() {
  const url = '/api/filmes' + (filtroAdmin ? '?administrador=' + encodeURIComponent(filtroAdmin) : '');
  const resp = await api(url);
  const filmes = await lerJson(resp);

  if (!resp.ok) return mensagem(filmes.erro);
  if (filmes.length === 0) return mensagem('Nenhum filme encontrado.');
    $('vitrine').innerHTML = filmes
    .map(
      (f) => `
      <div class="card">
        <img class="capa" src="uploads/capas/${f.url_capa}" alt="${esc(f.titulo_filme)}" />
        <div class="tooltip">
          Cadastrado por: @${esc(f.administrador_usuario)}<br />
          Gênero: ${esc(f.genero)}
        </div>
        <div class="info">
          <b>${esc(f.titulo_filme)}</b>
          <div class="curtidas">
            <span class="coracao ${f.curtido_por_mim ? 'ativa' : ''}" data-id="${f.id_filme}"></span>
            <span>${f.curtidas}</span>
          </div>
        </div>
      </div>`,
    )
    .join('');
}

// Curtir / descurtir (clicar de novo remove a curtida)
$('vitrine').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('coracao')) return;
  if (!usuario) return abrirModal();

  const resp = await api('/api/curtidas/' + e.target.dataset.id, { method: 'POST' });
  const dados = await resp.json();

  e.target.classList.toggle('ativa', dados.curtido);
  e.target.nextElementSibling.textContent = dados.curtidas;

  if (!$('painelPerfil').classList.contains('oculto')) carregarPerfil();
});

// ---------------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------------
function abrirModal() {
  limparErros();
  $('loginUsuario').value = '';
  $('loginSenha').value = '';
  $('modalLogin').classList.remove('oculto');
  $('loginUsuario').focus();
}

function fecharModal() {
  $('modalLogin').classList.add('oculto');
}

async function fazerLogin() {
  limparErros();
  const nome_usuario = $('loginUsuario').value.trim();
  const senha = $('loginSenha').value;

  if (nome_usuario.length < 3) {
    $('erroUsuario').textContent = 'O nome de usuário deve ter pelo menos 3 caracteres.';
  }
  if (senha === '') {
    $('erroSenha').textContent = 'A senha é obrigatória.';
  }
  if (nome_usuario.length < 3 || senha === '') return;

  let dados;
try {
  const resp = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome_usuario, senha }),
  });

  const texto = await resp.text();
  try {
    dados = JSON.parse(texto);
  } catch {
    console.error('Resposta não-JSON:', resp.status, texto.slice(0, 200));
    $('erroLogin').textContent = `Erro ${resp.status} no servidor.`;
    return;
  }

  if (!resp.ok) {
    $('erroLogin').textContent = dados.erro || 'Erro ao fazer login.';
    return;
  }
} catch (e) {
  $('erroLogin').textContent = 'Não foi possível conectar ao servidor.';
  return;
}

  localStorage.setItem('token', dados.token);
  localStorage.setItem('usuario', JSON.stringify(dados.usuario));
  usuario = dados.usuario;

  fecharModal();
  atualizarTela();
  carregarVitrine();
}

$('btnConfirmarLogin').addEventListener('click', fazerLogin);
$('btnCancelar').addEventListener('click', fecharModal);
$('fecharModal').addEventListener('click', fecharModal);

$('btnLogin').addEventListener('click', () => {
  if (usuario) sair(); // logout volta para a página inicial
  else abrirModal();
});

// ---------------------------------------------------------------------------
// BUSCA POR ADMINISTRADOR
// ---------------------------------------------------------------------------
function buscar() {
  if (!usuario) return abrirModal();

  const termo = $('inputBusca').value.trim().replace('@', '');
  if (termo !== '' && termo.length < 3) {
    return mensagem('Digite um nome válido, ex: curador1.');
  }

  filtroAdmin = termo; // vazio = mostra todos
  carregarVitrine();
}

$('inputBusca').addEventListener('focus', () => {
  if (!usuario) abrirModal();
});
$('inputBusca').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') buscar();
});
$('btnLupa').addEventListener('click', buscar);

// ---------------------------------------------------------------------------
// MENU LATERAL DO ADMINISTRADOR
// ---------------------------------------------------------------------------
async function carregarPerfil() {
  const resp = await api('/api/perfil');
  const dados = await resp.json();

  $('totalCurtidas').textContent = dados.totalCurtidas;
  $('totalFilmes').textContent = dados.totalFilmes;
  $('listaFilmes').innerHTML = dados.filmes
    .map(
      (f) => `
      <div class="item">
        <span>${esc(f.titulo_filme)}</span>
        <img class="lixeira" data-id="${f.id_filme}" src="uploads/icons/lixeira.svg" alt="Excluir" />
      </div>`,
    )
    .join('');
}

$('btnVerPerfil').addEventListener('click', async () => {
  if (!usuario) return abrirModal();
  if (usuario.tipo !== 'administrador') return;

  await carregarPerfil();
  $('painelPerfil').classList.remove('oculto');
});

$('btnSeusFilmes').addEventListener('click', carregarPerfil);
$('fecharPainel').addEventListener('click', () => {
  $('painelPerfil').classList.add('oculto');
});

// Excluir filme (lixeira)
$('listaFilmes').addEventListener('click', async (e) => {
  if (!e.target.classList.contains('lixeira')) return;

  const resp = await api('/api/filmes/' + e.target.dataset.id, { method: 'DELETE' });
  if (!resp.ok) return alert((await resp.json()).erro);

  carregarPerfil();
  carregarVitrine();
});

// ---------------------------------------------------------------------------
// CADASTRO DE FILME
// ---------------------------------------------------------------------------
function mostrarNomeArquivo() {
  const arquivo = $('campoCapa').files[0];
  $('nomeArquivo').textContent = arquivo ? arquivo.name : 'Nenhum arquivo escolhido';
}
$('campoCapa').addEventListener('change', mostrarNomeArquivo);

$('formCadastro').addEventListener('submit', async (e) => {
  e.preventDefault();
  limparErros();

  const titulo = $('campoTitulo').value.trim();
  const genero = $('campoGenero').value.trim();
  const arquivo = $('campoCapa').files[0];

  if (titulo === '') $('erroTitulo').textContent = 'O título do filme é obrigatório.';
  if (genero === '') $('erroGenero').textContent = 'O gênero é obrigatório.';

  if (!arquivo) {
    $('erroCapa').textContent = 'A capa é obrigatória.';
  } else if (!/\.(jpe?g|png|gif|webp)$/i.test(arquivo.name)) {
    $('erroCapa').textContent = 'Formato inválido (use JPG, JPEG, PNG, GIF ou WEBP).';
  }

  if (document.querySelector('#formCadastro .erro:not(:empty)')) return;

  const formData = new FormData();
  formData.append('titulo_filme', titulo);
  formData.append('genero', genero);
  formData.append('url_capa', arquivo);

  const resp = await api('/api/filmes', { method: 'POST', body: formData });
  if (!resp.ok) {
    $('erroCapa').textContent = (await resp.json()).erro;
    return;
  }

  $('formCadastro').reset();
  mostrarNomeArquivo();
  carregarPerfil();
  carregarVitrine();
});

// ---------------------------------------------------------------------------
// INÍCIO
// ---------------------------------------------------------------------------
atualizarTela();
carregarVitrine();
setInterval(carregarVitrine, 5000); // atualiza as curtidas sozinho, sem recarregar a página
