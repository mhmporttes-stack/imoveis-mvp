-- Troca o endereço que as rotinas do banco (pg_cron) chamam, da Vercel para o domínio da marca no servidor próprio.
-- NÃO rodar antes do túnel da Cloudflare estar no ar (https://www.matheusmachadoimoveis.com.br/ respondendo).
-- Só altera o endereço dentro do comando: horário, token e demais partes ficam iguais. Pede aprovação do dono antes de rodar.
-- Para voltar atrás: o mesmo comando com os dois endereços trocados.
do $$
declare r record;
begin
  for r in select jobid, command from cron.job where command like '%https://imoveis-mvp.vercel.app/%' loop
    perform cron.alter_job(r.jobid, command := replace(r.command, 'https://imoveis-mvp.vercel.app/', 'https://www.matheusmachadoimoveis.com.br/'));
  end loop;
end $$;

-- Conferir (nenhuma linha deve sobrar com vercel.app):
-- select jobid, jobname from cron.job where command like '%vercel.app%';
