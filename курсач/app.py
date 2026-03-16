from flask import Flask, render_template, request, jsonify, Response, send_file, session
import psycopg2, random, string, io, csv, os
import pandas as pd
from psycopg2.extras import RealDictCursor
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key-change-me")

def get_db_connection():
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        database=os.environ.get("DB_NAME", "city_library_fund"),
        user=os.environ.get("DB_USER", "postgres"),
        # Если переменная окружения не задана, используем пароль по умолчанию (как было раньше),
        # чтобы проект запускался без дополнительной настройки.
        password=os.environ.get("DB_PASSWORD", "hjvfghjaab111"),
        port=os.environ.get("DB_PORT", "5432")
    )

def require_roles(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            role = session.get("role")
            if role not in roles:
                return jsonify({"status": "error", "message": "Недостаточно прав"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator

@app.route('/')
def index():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    # Уникальные издания, включая те, у которых ещё нет экземпляров
    cur.execute('''
        WITH authors AS (
            SELECT 
                pa.id_publication,
                STRING_AGG(a.full_name, ', ') AS author_name
            FROM publication_author pa
            JOIN author a ON pa.id_author = a.id_author
            GROUP BY pa.id_publication
        )
        SELECT DISTINCT ON (p.id_publication)
            p.id_publication,
            p.title,
            COALESCE(au.author_name, '') AS author_name,
            pc.category_name,
            c.inventory_number,
            COALESCE(c.status, 'Нет в наличии') AS status
        FROM publication p
        JOIN publication_category pc ON p.id_pub_category = pc.id_pub_category
        LEFT JOIN authors au ON au.id_publication = p.id_publication
        LEFT JOIN copy c 
            ON p.id_publication = c.id_publication
           AND c.status != 'списано'
        ORDER BY p.id_publication,
                 CASE 
                    WHEN c.status = 'в наличии' THEN 1
                    WHEN c.status = 'выдано' THEN 2
                    WHEN c.status = 'забронировано' THEN 3
                    ELSE 4
                 END
    ''')
    books = cur.fetchall()
    cur.close()
    conn.close()
    return render_template('index.html', books=books)

# --- АВТОРИЗАЦИЯ ---
@app.route('/login', methods=['POST'])
def login():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM reader WHERE full_name = %s', (data.get('full_name'),))
    user = cur.fetchone()
    cur.close()
    conn.close()
    if user:
        session.clear()
        session["role"] = "reader"
        session["id_reader"] = user.get("id_reader")
    return jsonify({"status": "success", "user": user}) if user else jsonify({"status": "error", "message": "Читатель не найден"})

@app.route('/login_employee', methods=['POST'])
def login_employee():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM employee WHERE full_name = %s', (data.get('full_name'),))
    emp = cur.fetchone()
    cur.close()
    conn.close()
    if emp:
        session.clear()
        session["role"] = "employee"
        session["id_employee"] = emp.get("id_employee")
    return jsonify({"status": "success", "employee": emp}) if emp else jsonify({"status": "error", "message": "Сотрудник не найден"})


@app.route('/login_admin', methods=['POST'])
def login_admin():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM employee WHERE full_name = %s', (data.get('full_name'),))
    emp = cur.fetchone()
    cur.close()
    conn.close()
    if not emp:
        return jsonify({"status": "error", "message": "Администратор не найден"})

    # Правило: админ = сотрудник, у которого должность содержит "Заведующий"
    pos = (emp.get('position') or '').lower()
    if 'завед' not in pos:
        return jsonify({"status": "error", "message": "Недостаточно прав (не администратор)"}), 403

    session.clear()
    session["role"] = "admin"
    session["id_employee"] = emp.get("id_employee")
    return jsonify({"status": "success", "employee": emp})


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "success"})


@app.route('/admin/readers')
@require_roles("admin")
def admin_readers():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT 
            r.id_reader,
            r.full_name,
            rc.category_name AS category,
            l.name AS reg_library
        FROM reader r
        JOIN reader_category rc ON r.id_category = rc.id_category
        JOIN library l ON r.id_reg_library = l.id_library
        ORDER BY r.full_name
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)


@app.route('/admin/employees')
@require_roles("admin")
def admin_employees():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT 
            e.id_employee,
            e.full_name,
            e.position,
            l.name AS library
        FROM employee e
        JOIN library l ON e.id_library = l.id_library
        ORDER BY e.full_name
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)


@app.route('/admin/logreaders')
@require_roles("admin")
def admin_logreaders():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT 
            id,
            reader_name,
            category_id,
            operation
        FROM logReaders
        ORDER BY id DESC
        LIMIT 200
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)

# --- БРОНИРОВАНИЕ ---
@app.route('/create_booking', methods=['POST'])
@require_roles("reader")
def create_booking():
    data = request.json
    code = 'LIB-' + ''.join(random.choices(string.digits, k=4))
    conn = get_db_connection()
    cur = conn.cursor()
    try:
        cur.execute('INSERT INTO bookings (inventory_number, id_reader, booking_code) VALUES (%s, %s, %s)',
                   (data['inv'], data['user_id'], code))
        # Меняем статус в таблице copy
        cur.execute("UPDATE copy SET status = 'забронировано' WHERE inventory_number = %s", (data['inv'],))
        conn.commit()
        # Узнаем адрес библиотеки
        cur.execute("SELECT h.hall_number FROM copy c JOIN hall h ON c.id_hall = h.id_hall WHERE c.inventory_number = %s", (data['inv'],))
        hall = cur.fetchone()[0]
        return jsonify({"status": "success", "code": code, "hall": hall})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)})
    finally:
        cur.close()
        conn.close()

# --- ФУНКЦИИ СОТРУДНИКА ---
@app.route('/get_bookings')
@require_roles("employee", "admin")
def get_bookings():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT b.*, p.title, r.full_name 
        FROM bookings b
        JOIN copy c ON b.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        JOIN reader r ON b.id_reader = r.id_reader
        WHERE b.status != 'выдано'
    ''')
    res = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(res)

@app.route('/process_booking', methods=['POST'])
@require_roles("employee", "admin")
def process_booking():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute("UPDATE bookings SET status = 'собран' WHERE id_booking = %s", (data['id'],))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"status": "success"})

@app.route('/issue_by_code', methods=['POST'])
@require_roles("employee", "admin")
def issue_by_code():
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # Находим бронь
        cur.execute("SELECT * FROM bookings WHERE booking_code = %s AND status = 'собран'", (data['code'],))
        booking = cur.fetchone()
        if not booking: return jsonify({"status": "error", "message": "Код не найден или заказ не собран"})
        
        # Создаем выдачу (на 14 дней)
        cur.execute('''
            INSERT INTO issue (inventory_number, id_reader, id_employee, due_date)
            VALUES (%s, %s, %s, CURRENT_DATE + 14)
        ''', (booking['inventory_number'], booking['id_reader'], data['emp_id']))
        
        cur.execute("UPDATE copy SET status = 'выдано' WHERE inventory_number = %s", (booking['inventory_number'],))
        cur.execute("UPDATE bookings SET status = 'выдано' WHERE id_booking = %s", (booking['id_booking'],))
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)})
    finally:
        cur.close()
        conn.close()

# Статистика и добавление (как было раньше)
@app.route('/get_all_copies')
@require_roles("employee", "admin")
def get_all_copies():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT c.inventory_number, p.title, h.hall_number, c.status FROM copy c JOIN publication p ON c.id_publication = p.id_publication JOIN hall h ON c.id_hall = h.id_hall')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)


@app.route('/get_writtenoff_copies')
@require_roles("employee", "admin")
def get_writtenoff_copies():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT 
            c.inventory_number, 
            p.title, 
            h.hall_number, 
            c.status
        FROM copy c 
        JOIN publication p ON c.id_publication = p.id_publication 
        JOIN hall h ON c.id_hall = h.id_hall
        WHERE c.status = 'списано'
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)

@app.route('/get_active_issues')
@require_roles("employee", "admin")
def get_active_issues():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT 
            i.inventory_number, 
            p.title, 
            r.full_name as reader, 
            h.hall_number,
            i.due_date,
            GREATEST(CURRENT_DATE - i.due_date, 0) AS days_overdue
        FROM issue i 
        JOIN copy c ON i.inventory_number = c.inventory_number 
        JOIN publication p ON c.id_publication = p.id_publication 
        JOIN reader r ON i.id_reader = r.id_reader
        JOIN hall h ON c.id_hall = h.id_hall
        WHERE i.return_date IS NULL
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(rows)

@app.route('/get_stats')
@require_roles("employee", "admin")
def get_stats():
    conn = get_db_connection()
    cur = conn.cursor()
    # Считаем все книги
    cur.execute('SELECT count(*) FROM copy')
    total = cur.fetchone()[0]
    # Считаем книги на руках (где нет даты возврата)
    cur.execute('SELECT count(*) FROM issue WHERE return_date IS NULL')
    active = cur.fetchone()[0]

    # Распределение по статусам экземпляров
    cur.execute('SELECT status, count(*) FROM copy GROUP BY status')
    status_rows = cur.fetchall()
    status_counts = {row[0]: row[1] for row in status_rows}
    cur.close()
    conn.close()
    return jsonify({"total": total, "active": active, "status_counts": status_counts})


@app.route('/writeoff_copy', methods=['POST'])
@require_roles("employee", "admin")
def writeoff_copy():
    data = request.json
    inv = data.get('inventory_number')
    if not inv:
        return jsonify({"status": "error", "message": "Не указан инвентарный номер"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Разрешаем списывать только экземпляры "в наличии"
        cur.execute(
            "UPDATE copy SET status = 'списано' WHERE inventory_number = %s AND status = 'в наличии'",
            (inv,)
        )
        if cur.rowcount == 0:
            conn.rollback()
            return jsonify({"status": "error", "message": "Экземпляр нельзя списать (не в наличии или не найден)"}), 400
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)})
    finally:
        cur.close()
        conn.close()


@app.route('/add_book', methods=['POST'])
@require_roles("employee", "admin")
def add_book():
    data = request.json
    title = data.get('title')
    year = data.get('year')
    author_id = data.get('author_id')
    author_name = data.get('author_name')
    pub_type = data.get('pub_type', 'Книга')

    if not title or not year:
        return jsonify({"status": "error", "message": "Не заполнены обязательные поля (Название, Год)"}), 400

    # Маппинг названия категории на id_pub_category
    category_map = {
        'Книга': 1,
        'Журнал': 2,
        'Диссертация': 3,
        'Газета': 4,
        'Сборник статей': 5
    }
    cat_id = category_map.get(pub_type, 1)

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Определяем id автора: либо из списка, либо создаём нового
        if author_id:
            author_id_int = int(author_id)
        elif author_name:
            cur.execute(
                "INSERT INTO author (full_name) VALUES (%s) RETURNING id_author",
                (author_name,)
            )
            author_id_int = cur.fetchone()[0]
        else:
            return jsonify({"status": "error", "message": "Укажите автора (из списка или вручную)"}), 400

        # 1. Добавляем запись в publication
        cur.execute(
            "INSERT INTO publication (title, publish_year, id_pub_category) VALUES (%s, %s, %s) RETURNING id_publication",
            (title, year, cat_id)
        )
        pub_id = cur.fetchone()[0]

        # 2. Привязываем автора через таблицу publication_author
        cur.execute(
            "INSERT INTO publication_author (id_publication, id_author) VALUES (%s, %s)",
            (pub_id, author_id_int)
        )

        # 3. Генерируем инвентарный номер и создаём экземпляр в первом зале
        inv = 'INV-' + ''.join(random.choices(string.digits, k=6))
        cur.execute(
            "INSERT INTO copy (inventory_number, id_publication, id_hall, shelf, rack, status) "
            "VALUES (%s, %s, %s, %s, %s, 'в наличии')",
            (inv, pub_id, 1, 'A', '1')
        )
        conn.commit()
        return jsonify({"status": "success", "inventory_number": inv})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)})
    finally:
        cur.close()
        conn.close()


def _csv_response(filename, header, rows):
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=';')
    writer.writerow(header)
    for r in rows:
        writer.writerow(r)
    resp = Response(buf.getvalue(), mimetype='text/csv; charset=utf-8')
    resp.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp


@app.route('/report/daily_issues')
@require_roles("employee", "admin")
def report_daily_issues():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT 
            i.issue_date,
            i.inventory_number,
            p.title,
            r.full_name AS reader,
            e.full_name AS employee,
            i.due_date
        FROM issue i
        JOIN copy c ON i.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        JOIN reader r ON i.id_reader = r.id_reader
        JOIN employee e ON i.id_employee = e.id_employee
        WHERE i.issue_date = CURRENT_DATE
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    header = ['Дата выдачи', 'Инв. номер', 'Название', 'Читатель', 'Сотрудник', 'Вернуть до']
    return _csv_response('daily_issues.csv', header, rows)


@app.route('/report/daily_returns')
@require_roles("employee", "admin")
def report_daily_returns():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT 
            i.return_date,
            i.inventory_number,
            p.title,
            r.full_name AS reader,
            e.full_name AS employee,
            i.issue_date,
            i.due_date
        FROM issue i
        JOIN copy c ON i.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        JOIN reader r ON i.id_reader = r.id_reader
        JOIN employee e ON i.id_employee = e.id_employee
        WHERE i.return_date = CURRENT_DATE
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    header = ['Дата возврата', 'Инв. номер', 'Название', 'Читатель', 'Сотрудник', 'Дата выдачи', 'Вернуть до']
    return _csv_response('daily_returns.csv', header, rows)


@app.route('/report/weekly_load')
@require_roles("employee", "admin")
def report_weekly_load():
    conn = get_db_connection()
    cur = conn.cursor()
    # Кол-во выдач по дням за последние 7 дней
    cur.execute('''
        SELECT 
            i.issue_date::date AS day,
            COUNT(*) AS issues_count
        FROM issue i
        WHERE i.issue_date >= CURRENT_DATE - 7
        GROUP BY day
        ORDER BY day
    ''')
    issue_rows = {row[0]: row[1] for row in cur.fetchall()}

    # Кол-во заказов по читателям за последние 7 дней (по датам выдачи)
    cur.execute('''
        SELECT 
            r.full_name,
            COUNT(*) AS issues_count
        FROM issue i
        JOIN reader r ON i.id_reader = r.id_reader
        WHERE i.issue_date >= CURRENT_DATE - 7
        GROUP BY r.full_name
        ORDER BY issues_count DESC
    ''')
    per_reader = cur.fetchall()
    cur.close()
    conn.close()

    header = ['День', 'Выдано экземпляров']
    day_rows = [(d, issue_rows.get(d, 0)) for d in sorted(issue_rows.keys())]
    # Для простоты делаем один CSV, после дневной статистики добавляем пустую строку и блок по читателям
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=';')
    w.writerow(header)
    for r in day_rows:
        w.writerow(r)
    w.writerow([])
    w.writerow(['Читатель', 'Выдано за 7 дней'])
    for r in per_reader:
        w.writerow(r)
    resp = Response(buf.getvalue(), mimetype='text/csv; charset=utf-8')
    resp.headers['Content-Disposition'] = 'attachment; filename="weekly_load.csv"'
    return resp


@app.route('/report/writeoff_act')
@require_roles("employee", "admin")
def report_writeoff_act():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('''
        SELECT 
            c.inventory_number,
            p.title,
            h.hall_number,
            c.status
        FROM copy c
        JOIN publication p ON c.id_publication = p.id_publication
        JOIN hall h ON c.id_hall = h.id_hall
        WHERE c.status = 'списано'
    ''')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    header = ['Инв. номер', 'Название', 'Зал', 'Статус']
    return _csv_response('writeoff_act.csv', header, rows)


@app.route('/export_report')
@require_roles("employee", "admin")
def export_report():
    """Экспорт отчётов в Excel (.xlsx). Параметр type:
       - all_copies: все экземпляры
       - issues_history: история выдач/возвратов
    """
    report_type = request.args.get('type', 'all_copies')
    conn = get_db_connection()

    if report_type == 'issues_history':
        sql = '''
            SELECT 
                i.issue_date AS "Дата_выдачи",
                i.return_date AS "Дата_возврата",
                i.inventory_number AS "Инвентарный_номер",
                p.title AS "Название",
                pc.category_name AS "Тип",
                r.full_name AS "Читатель",
                e.full_name AS "Сотрудник",
                i.due_date AS "Вернуть_до"
            FROM issue i
            JOIN copy c ON i.inventory_number = c.inventory_number
            JOIN publication p ON c.id_publication = p.id_publication
            JOIN publication_category pc ON p.id_pub_category = pc.id_pub_category
            JOIN reader r ON i.id_reader = r.id_reader
            JOIN employee e ON i.id_employee = e.id_employee
            ORDER BY i.issue_date DESC
        '''
        filename = 'issues_history.xlsx'
    else:
        sql = '''
            SELECT 
                c.inventory_number AS "Инвентарный_номер",
                p.title AS "Название",
                pc.category_name AS "Тип",
                h.hall_number AS "Зал",
                c.status AS "Статус"
            FROM copy c
            JOIN publication p ON c.id_publication = p.id_publication
            JOIN publication_category pc ON p.id_pub_category = pc.id_pub_category
            JOIN hall h ON c.id_hall = h.id_hall
            ORDER BY p.title
        '''
        filename = 'all_copies.xlsx'

    df = pd.read_sql_query(sql, conn)
    conn.close()

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Отчёт')
    output.seek(0)

    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/get_reader_info/<int:reader_id>')
@require_roles("reader")
def get_reader_info(reader_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 1. Получаем активные бронирования
    cur.execute('''
        SELECT b.booking_code, p.title, b.status 
        FROM bookings b
        JOIN copy c ON b.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        WHERE b.id_reader = %s AND b.status != 'выдано'
    ''', (reader_id,))
    bookings = cur.fetchall()
    
    # 2. Получаем выданные книги (те, что на руках)
    cur.execute('''
        SELECT 
            p.title, 
            i.due_date, 
            c.inventory_number,
            GREATEST(CURRENT_DATE - i.due_date, 0) AS days_overdue
        FROM issue i
        JOIN copy c ON i.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        WHERE i.id_reader = %s AND i.return_date IS NULL
    ''', (reader_id,))
    issues = cur.fetchall()

    # 3. История чтений (возвращённые книги)
    cur.execute('''
        SELECT 
            p.title,
            i.issue_date,
            i.return_date,
            c.inventory_number
        FROM issue i
        JOIN copy c ON i.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        WHERE i.id_reader = %s AND i.return_date IS NOT NULL
        ORDER BY i.issue_date DESC
    ''', (reader_id,))
    history = cur.fetchall()
    
    cur.close()
    conn.close()
    return jsonify({"bookings": bookings, "issues": issues, "history": history})


@app.route('/return_issue', methods=['POST'])
@require_roles("employee", "admin")
def return_issue():
    data = request.json
    inv = data.get('inventory_number')
    if not inv:
        return jsonify({"status": "error", "message": "Не указан инвентарный номер"}), 400

    conn = get_db_connection()
    cur = conn.cursor()
    try:
        # Проставляем дату возврата для активной выдачи
        cur.execute(
            "UPDATE issue SET return_date = CURRENT_DATE WHERE inventory_number = %s AND return_date IS NULL",
            (inv,)
        )
        # Меняем статус экземпляра
        cur.execute(
            "UPDATE copy SET status = 'в наличии' WHERE inventory_number = %s",
            (inv,)
        )
        conn.commit()
        return jsonify({"status": "success"})
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": str(e)})
    finally:
        cur.close()
        conn.close()

@app.route('/get_user_bookings/<int:user_id>')
@require_roles("reader")
def get_user_bookings(user_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('''
        SELECT b.booking_code, p.title, b.status 
        FROM bookings b
        JOIN copy c ON b.inventory_number = c.inventory_number
        JOIN publication p ON c.id_publication = p.id_publication
        WHERE b.id_reader = %s AND b.status != 'выдано'
    ''', (user_id,))
    res = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(res)


if __name__ == '__main__':
    app.run(debug=True)
