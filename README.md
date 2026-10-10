# Finance 2 Practice Quest: квест с автосохранением

Структура: public/ (index.html для студентов, teacher.html для преподавателя), api/ (функции Vercel), lib/ (логика, ключи ответов, доступ к базе), supabase.sql (таблицы), tests/ (проверки).

Переменные окружения Vercel:
- SUPABASE_URL (Project URL из Supabase)
- SUPABASE_SERVICE_ROLE_KEY (service_role key, только на сервере)
- TEACHER_PASSWORD (пароль страницы /teacher)
- JURY_PASSWORDS (члены жюри, формат Имя1:пароль1,Имя2:пароль2; пароли без запятых и двоеточий; страница /jury)
- ALLOWED_GROUPS (необязательно, через запятую; по умолчанию 24ОФ1,24ОФ2,24ОФ3,24ОФ4)

Проверка: `npm test` не требует установки пакетов (API), браузерный тест tests/browser.js требует playwright.
