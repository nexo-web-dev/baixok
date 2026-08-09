import { todos, um } from "../db/postgres.js";

const paraApi = linha => linha && ({
  usuarioId: linha.usuario_id,
  usuario: linha.usuario || "",
  nome: linha.usuario_nome || linha.usuario_nome_atual || linha.usuario || "Motoboy",
  papel: linha.papel || "entregador",
  deviceId: linha.dispositivo_id || "principal",
  deviceName: linha.dispositivo_nome || "",
  lat: Number(linha.lat),
  lng: Number(linha.lng),
  accuracy: linha.precisao == null ? null : Number(linha.precisao),
  online: new Date(linha.atualizado_em).getTime() >= Date.now() - 15000,
  updatedAt: linha.atualizado_em
});

export const motoboysRepo = {
  async salvarLocalizacao(usuario, { lat, lng, accuracy = null, deviceId = "principal", deviceName = "", motoboy = "" }) {
    const nomeVisivel = String(motoboy || "").trim() || usuario.nome || usuario.usuario || "Motoboy";
    const linha = await um(`
      INSERT INTO motoboy_localizacoes (
        usuario_id, usuario_nome, papel, dispositivo_id, dispositivo_nome, lat, lng, precisao, atualizado_em
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
      ON CONFLICT (usuario_id, dispositivo_id) DO UPDATE SET
        usuario_nome = EXCLUDED.usuario_nome,
        papel = EXCLUDED.papel,
        dispositivo_nome = EXCLUDED.dispositivo_nome,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        precisao = EXCLUDED.precisao,
        atualizado_em = now()
      RETURNING *
    `, [
      usuario.id,
      nomeVisivel,
      usuario.papel || "entregador",
      deviceId,
      deviceName,
      lat,
      lng,
      accuracy
    ]);
    return paraApi(linha);
  },

  async listarLocalizacoes({ horas = 12 } = {}) {
    const linhas = await todos(`
      SELECT l.*, u.usuario, u.nome AS usuario_nome_atual, u.papel
        FROM motoboy_localizacoes l
        LEFT JOIN usuarios u ON u.id = l.usuario_id
       WHERE l.atualizado_em >= now() - (?::int * interval '1 hour')
       ORDER BY l.atualizado_em DESC
       LIMIT 100
    `, [horas]);
    return linhas.map(paraApi);
  }
};
