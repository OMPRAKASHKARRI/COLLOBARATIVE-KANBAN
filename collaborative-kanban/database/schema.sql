-- PostgreSQL database dump

\restrict QIBqpRQBk4Vum6oXPSkDbRHNqj7wLMVbbogWkyPZouaM8MyGbAqJplvB9Z7oma6

-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)


-- Name: Priority; Type: TYPE; Schema: public; Owner: -

CREATE TYPE public."Priority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
);


-- Name: Role; Type: TYPE; Schema: public; Owner: -

CREATE TYPE public."Role" AS ENUM (
    'ORG_ADMIN',
    'TENANT_ADMIN',
    'MEMBER'
);






-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.activity_logs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    entity_type character varying(40) NOT NULL,
    entity_id uuid NOT NULL,
    action character varying(40) NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- Name: boards; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.boards (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_by uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


-- Name: columns; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.columns (
    id uuid NOT NULL,
    board_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


-- Name: memberships; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.memberships (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    tenant_id uuid,
    role public."Role" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT memberships_role_scope_chk CHECK ((((tenant_id IS NULL) AND (role = 'ORG_ADMIN'::public."Role")) OR ((tenant_id IS NOT NULL) AND (role <> 'ORG_ADMIN'::public."Role"))))
);


-- Name: organizations; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


-- Name: tasks; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.tasks (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    board_id uuid NOT NULL,
    column_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    assigned_to uuid,
    created_by uuid,
    priority public."Priority" DEFAULT 'MEDIUM'::public."Priority" NOT NULL,
    due_date timestamp(3) without time zone,
    "position" integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT tasks_position_chk CHECK (("position" >= 0)),
    CONSTRAINT tasks_version_chk CHECK ((version >= 1))
);


-- Name: tenants; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.tenants (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


-- Name: users; Type: TABLE; Schema: public; Owner: -

CREATE TABLE public.users (
    id uuid NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    token_version integer DEFAULT 0 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);




-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


-- Name: boards boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);


-- Name: columns columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.columns
    ADD CONSTRAINT columns_pkey PRIMARY KEY (id);


-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


-- Name: activity_logs_entity_type_entity_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX activity_logs_entity_type_entity_id_idx ON public.activity_logs USING btree (entity_type, entity_id);


-- Name: activity_logs_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX activity_logs_tenant_id_created_at_idx ON public.activity_logs USING btree (tenant_id, created_at DESC);


-- Name: boards_id_tenant_id_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX boards_id_tenant_id_key ON public.boards USING btree (id, tenant_id);


-- Name: boards_organization_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX boards_organization_id_idx ON public.boards USING btree (organization_id);


-- Name: boards_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX boards_tenant_id_created_at_idx ON public.boards USING btree (tenant_id, created_at);


-- Name: columns_board_id_position_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX columns_board_id_position_idx ON public.columns USING btree (board_id, "position");


-- Name: columns_id_board_id_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX columns_id_board_id_key ON public.columns USING btree (id, board_id);


-- Name: columns_id_tenant_id_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX columns_id_tenant_id_key ON public.columns USING btree (id, tenant_id);


-- Name: columns_tenant_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX columns_tenant_id_idx ON public.columns USING btree (tenant_id);


-- Name: memberships_org_level_unique; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX memberships_org_level_unique ON public.memberships USING btree (user_id, organization_id) WHERE (tenant_id IS NULL);


-- Name: memberships_organization_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX memberships_organization_id_idx ON public.memberships USING btree (organization_id);


-- Name: memberships_tenant_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX memberships_tenant_id_idx ON public.memberships USING btree (tenant_id);


-- Name: memberships_user_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX memberships_user_id_idx ON public.memberships USING btree (user_id);


-- Name: memberships_user_id_organization_id_tenant_id_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX memberships_user_id_organization_id_tenant_id_key ON public.memberships USING btree (user_id, organization_id, tenant_id);


-- Name: tasks_assigned_to_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX tasks_assigned_to_idx ON public.tasks USING btree (assigned_to);


-- Name: tasks_board_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX tasks_board_id_idx ON public.tasks USING btree (board_id);


-- Name: tasks_column_id_position_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX tasks_column_id_position_idx ON public.tasks USING btree (column_id, "position");


-- Name: tasks_tenant_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX tasks_tenant_id_idx ON public.tasks USING btree (tenant_id);


-- Name: tenants_id_organization_id_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX tenants_id_organization_id_key ON public.tenants USING btree (id, organization_id);


-- Name: tenants_organization_id_idx; Type: INDEX; Schema: public; Owner: -

CREATE INDEX tenants_organization_id_idx ON public.tenants USING btree (organization_id);


-- Name: tenants_organization_id_name_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX tenants_organization_id_name_key ON public.tenants USING btree (organization_id, name);


-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


-- Name: activity_logs activity_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: activity_logs activity_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


-- Name: boards boards_tenant_id_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_tenant_id_organization_id_fkey FOREIGN KEY (tenant_id, organization_id) REFERENCES public.tenants(id, organization_id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: columns columns_board_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.columns
    ADD CONSTRAINT columns_board_id_tenant_id_fkey FOREIGN KEY (board_id, tenant_id) REFERENCES public.boards(id, tenant_id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: memberships memberships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: memberships memberships_tenant_org_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_tenant_org_fkey FOREIGN KEY (tenant_id, organization_id) REFERENCES public.tenants(id, organization_id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: memberships memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: tasks tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


-- Name: tasks tasks_board_id_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_board_id_tenant_id_fkey FOREIGN KEY (board_id, tenant_id) REFERENCES public.boards(id, tenant_id) ON UPDATE CASCADE ON DELETE CASCADE;


-- Name: tasks tasks_column_id_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_column_id_board_id_fkey FOREIGN KEY (column_id, board_id) REFERENCES public.columns(id, board_id) ON UPDATE CASCADE ON DELETE RESTRICT;


-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


-- Name: tenants tenants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


-- PostgreSQL database dump complete

\unrestrict QIBqpRQBk4Vum6oXPSkDbRHNqj7wLMVbbogWkyPZouaM8MyGbAqJplvB9Z7oma6

