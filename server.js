const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Configuração do banco usando variáveis de ambiente (com fallback para local)
const pool = new Pool({
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'senai',
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'streamFlix',
  ssl: process.env.PGHOST ? { rejectUnauthorized: false } : false, // Necessário para bancos na nuvem (Supabase, Render, Neon)
});

// Multer configurado em memória (sem gravar no disco)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext));
  },
});

// { token: usuario } - fica na memória
const sessoes = {};

const pegarSessao = (req) =>
  sessoes[(req.headers.authorization || '').replace('Bearer ', '')];

function logado(req, res, next) {
  req.usuario = pegarSessao(req);
  if (!req.usuario) return res.status(401).json({ erro: 'Faça login' });
  next();
}

function soAdmin(req, res, next) {
  if (req.usuario.tipo !== 'administrador') {
    return res.status(403).json({ erro: 'Apenas administradores' });
  }
  next();
}

app.post('/api/login', async (req, res) => {
  const { nome_usuario, senha } = req.body;
  const r = await pool.query(
    `SELECT id_usuario, nome, nome_usuario, email, imagem_usuario, tipo
     FROM tb_usuario WHERE nome_usuario = $1 AND senha = $2`,
    [nome_usuario, senha],
  );

  if (r.rows.length === 0) {
    return res
      .status(401)
      .json({ erro: 'Usuário não encontrado ou senha incorreta' });
  }

  const token = crypto.randomBytes(16).toString('hex');
  sessoes[token] = r.rows[0];
  res.json({ token, usuario: r.rows[0] });
});

// Todos os filmes, ou só os de um admin com ?administrador=curador1 (precisa logar)
app.get('/api/filmes', async (req, res) => {
  try {
    const usuario = pegarSessao(req);
    const params = [usuario ? usuario.id_usuario : null];
    let filtro = '';
    const busca = (req.query.administrador || '').trim().replace('@', '');

    if (busca) {
      if (!usuario) return res.status(401).json({ erro: 'Faça login' });

      const admin = await pool.query(
        `SELECT id_usuario FROM tb_usuario
         WHERE nome_usuario = $1 AND tipo = 'administrador'`,
        [busca],
      );

      if (admin.rows.length === 0) {
        return res.status(404).json({ erro: 'Administrador não encontrado' });
      }

      params.push(admin.rows[0].id_usuario);
      filtro = 'WHERE f.id_usuario = $2';
    }

    const r = await pool.query(
      `SELECT f.id_filme, f.titulo_filme, f.genero, f.url_capa,
              u.nome_usuario AS administrador_usuario,
              (SELECT COUNT(*) FROM tb_curtida c
                WHERE c.id_filme = f.id_filme)::int AS curtidas,
              EXISTS (SELECT 1 FROM tb_curtida cm
                WHERE cm.id_filme = f.id_filme AND cm.id_usuario = $1
              ) AS curtido_por_mim
       FROM tb_filme f
       JOIN tb_usuario u ON u.id_usuario = f.id_usuario
       ${filtro}
       ORDER BY f.id_filme DESC`,
      params,
    );

    res.json(r.rows);
  } catch (erro) {
    console.error('Erro ao buscar filmes:', erro);
    res.status(500).json({ erro: 'Erro interno ao buscar filmes no banco de dados' });
  }
});

app.post(
  '/api/filmes',
  [logado, soAdmin],
  upload.single('url_capa'),
  async (req, res) => {
    const { titulo_filme, genero } = req.body;
    if (!titulo_filme || !genero || !req.file) {
      return res.status(400).json({
        erro: 'Preencha título, gênero e uma capa (JPG, JPEG, PNG, GIF ou WEBP)',
      });
    }

    // Converte a imagem enviada em memória para Base64 Data URL
    const urlCapa = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const r = await pool.query(
      `INSERT INTO tb_filme (titulo_filme, genero, url_capa, id_usuario)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [titulo_filme, genero, urlCapa, req.usuario.id_usuario],
    );
    res.status(201).json(r.rows[0]);
  },
);

app.delete('/api/filmes/:id_filme', [logado, soAdmin], async (req, res) => {
  const { id_filme } = req.params;
  const { id_usuario } = req.usuario;

  // só apaga se o filme for do admin logado
  const filme = await pool.query(
    'SELECT 1 FROM tb_filme WHERE id_filme = $1 AND id_usuario = $2',
    [id_filme, id_usuario],
  );
  if (filme.rows.length === 0) {
    return res.status(404).json({ erro: 'Filme não encontrado' });
  }

  await pool.query('DELETE FROM tb_curtida WHERE id_filme = $1', [id_filme]);
  await pool.query('DELETE FROM tb_filme WHERE id_filme = $1', [id_filme]);
  res.json({ ok: true });
});

// Se já curtiu, remove a curtida; se não, adiciona
app.post('/api/curtidas/:id_filme', logado, async (req, res) => {
  const { id_filme } = req.params;
  const { id_usuario } = req.usuario;

  const del = await pool.query(
    'DELETE FROM tb_curtida WHERE id_usuario = $1 AND id_filme = $2',
    [id_usuario, id_filme],
  );
  const curtido = del.rowCount === 0;
  if (curtido) {
    await pool.query(
      'INSERT INTO tb_curtida (id_usuario, id_filme) VALUES ($1, $2)',
      [id_usuario, id_filme],
    );
  }

  const total = await pool.query(
    'SELECT COUNT(*)::int AS total FROM tb_curtida WHERE id_filme = $1',
    [id_filme],
  );
  res.json({ curtido, curtidas: total.rows[0].total });
});

// Dados do admin logado: likes, filmes e "Seus filmes"
app.get('/api/perfil', logado, async (req, res) => {
  const filmes = await pool.query(
    `SELECT f.id_filme, f.titulo_filme, f.genero, f.url_capa,
            (SELECT COUNT(*) FROM tb_curtida c
              WHERE c.id_filme = f.id_filme)::int AS curtidas
     FROM tb_filme f WHERE f.id_usuario = $1
     ORDER BY f.id_filme DESC`,
    [req.usuario.id_usuario],
  );

  let totalCurtidas = 0;
  for (const f of filmes.rows) totalCurtidas += f.curtidas;

  res.json({
    usuario: req.usuario,
    totalFilmes: filmes.rows.length,
    totalCurtidas,
    filmes: filmes.rows,
  });
});

// Servir arquivos estáticos da pasta public usando o diretório raiz de execução
app.use(express.static(path.join(process.cwd(), 'public')));

// Rota de fallback atualizada para o Express 5
app.get('(.*)', (req, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(500).send(`Erro ao carregar interface: ${err.message}. Caminho buscado: ${indexPath}`);
    }
  });
});

// Executa localmente
if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => console.log('Servidor rodando em http://localhost:3000'));
}

module.exports = app;
