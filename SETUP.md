# MARKYS LICENÇAS

Central web administrativa independente para controlar licenças dos sistemas MARKYS. Repositório **privado**.

## Stack
- React + TypeScript + Vite
- Supabase Auth (administradores)
- Supabase PostgreSQL com RLS e funções protegidas
- Hospedagem estática em Cloudflare Workers/Pages

## Configuração

1. Crie um **novo projeto Supabase**, independente dos sistemas clientes.
2. No SQL Editor desse novo projeto, execute `supabase/migrations/001_markys_licencas.sql`. A migração foi escrita para execução manual e **não foi aplicada automaticamente**.
3. Crie sua conta de administrador pelo Supabase Auth (Users). Não habilite cadastro público pelo painel.
4. No SQL Editor, após verificar seu UUID de usuário administrador, execute:

```sql
insert into public.markys_admins(user_id) values ('SEU-UUID-AQUI'::uuid);
```

Não use o UUID de um cliente. O acesso não depende de conhecer apenas um e-mail.
5. Copie `.env.example` para `.env.local` e configure **somente** a URL e chave pública (publishable/anon), nunca service_role nem banco/senhas.
6. Execute:

```bash
npm install
npm run dev
npm run build
```

7. Hospede o diretório `dist/` em ambiente HTTPS. Configure as duas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` no build da hospedagem.

## Módulos implementados na primeira base
- Login de administrador autorizado
- Dashboard de contadores
- Sistemas, compradores, planos, licenças, dispositivos, financeiro e auditoria
- Cadastro e edição de sistemas, compradores, planos, licenças e parcelas
- Ativação e bloqueio de licenças
- Reset dos dispositivos associados à licença
- Histórico de operações administrativas no banco

## Importante — segurança e implantação

**Não utilize esta interface como autorização para liberar APKs ainda.**
A migração cria funções de gerenciamento **somente para administradores**. O APK cliente **ainda não se comunica** com esta central. Falta implementar endpoint de validação seguro entre projetos Supabase distintos, autenticação de tokens do projeto de origem, leases offline assinadas e testes de bloqueio real. A licença não deve confiar em estado decidido pelo próprio aplicativo.

O painel não usa secret/service_role no navegador. As funções `security definer` verificam `auth.uid()` consultando `markys_admins`. Este código precisa passar por testes de segurança e revisão antes de ambiente de produção.

Mantenha o Supabase dos sistemas clientes separado do Supabase da central. Dados de vendas e fotos permanecem locais no PDV. Não habilite o projeto SQL antigo de licenciamento no Supabase do PDV.

**Financeiro** nesta versão é manual: registro de parcelas e situação. Não há integração com meios de pagamento, conciliação ou cobrança automática.

**Restrições atuais:** sem notificações automáticas, sem recuperação especial de administrador e sem API de ativação para os aplicativos. A regra de início/vencimento e acesso offline será efetivamente executada pela futura API.

## Desenvolvimento

A branch `feat/central-licencas` contém esta implementação inicial. Abra e revise o PR antes do merge em `main`.
