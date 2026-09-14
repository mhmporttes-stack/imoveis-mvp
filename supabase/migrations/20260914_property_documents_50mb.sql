-- O bucket "property-documents" (Book/e-book dos empreendimentos) estava
-- limitado a 20 MB — livros/catálogos reais com fotos em alta resolução
-- frequentemente passam disso. Eleva para 50 MB, mesmo limite já usado no
-- bucket "testimonials" deste projeto para arquivos de mídia grandes.
update storage.buckets
set file_size_limit = 50000000
where id = 'property-documents';
