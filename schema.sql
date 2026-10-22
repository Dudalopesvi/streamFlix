-- schema.sql

CREATE TABLE tb_usuario (
  id_usuario SERIAL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  nome_usuario VARCHAR(50) UNIQUE NOT NULL,
  senha VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  imagem_usuario VARCHAR(255),
  tipo VARCHAR(255) NOT NULL,
  create_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()

);

CREATE TABLE tb_filme (
  id_filme SERIAL PRIMARY KEY,
  titulo_filme VARCHAR(100) NOT NULL,
  genero VARCHAR(100) NOT NULL,
  url_capa VARCHAR(255) NOT NULL,
  id_usuario INTEGER NOT NULL REFERENCES tb_usuario(id_usuario) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  create_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tb_curtida (
  id_curtida SERIAL PRIMARY KEY,
  id_usuario INTEGER NOT NULL REFERENCES tb_usuario(id_usuario) ON DELETE CASCADE,
  id_filme INTEGER NOT NULL REFERENCES tb_filme(id_filme) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  create_at TIMESTAMPTZ DEFAULT NOW()
);

