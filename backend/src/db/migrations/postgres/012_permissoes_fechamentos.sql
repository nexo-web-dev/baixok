-- Inclui as abas novas nas permissoes existentes sem remover personalizacoes.

UPDATE usuarios
   SET abas_ver = (
         SELECT jsonb_agg(DISTINCT aba)::text
           FROM (
             SELECT jsonb_array_elements_text(abas_ver::jsonb) AS aba
             UNION ALL
             SELECT unnest(ARRAY['pedidos','motoboy','mesas','produtos','promos','entrega','estoque','dashboard','fechamentos','plano','usuarios'])
           ) extras
       ),
       abas_editar = (
         SELECT jsonb_agg(DISTINCT aba)::text
           FROM (
             SELECT jsonb_array_elements_text(abas_editar::jsonb) AS aba
             UNION ALL
             SELECT unnest(ARRAY['pedidos','motoboy','mesas','produtos','promos','entrega','estoque','dashboard','fechamentos','plano','usuarios'])
           ) extras
       )
 WHERE papel = 'admin';

UPDATE usuarios
   SET abas_ver = (
         SELECT jsonb_agg(DISTINCT aba)::text
           FROM (
             SELECT jsonb_array_elements_text(abas_ver::jsonb) AS aba
             UNION ALL
             SELECT unnest(ARRAY['motoboy','dashboard','fechamentos'])
           ) extras
       ),
       abas_editar = (
         SELECT jsonb_agg(DISTINCT aba)::text
           FROM (
             SELECT jsonb_array_elements_text(abas_editar::jsonb) AS aba
             UNION ALL
             SELECT unnest(ARRAY['motoboy'])
           ) extras
       )
 WHERE papel = 'caixa';
