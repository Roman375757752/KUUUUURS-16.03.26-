let isUserEmployee = false;
let userData = JSON.parse(sessionStorage.getItem('userData')) || null;
let selectedInv = null;

window.onload = function() {
    if (userData) {
        showMainUI(userData);
    }
};  

    // Переключение между Входом и Регистрацией
    function toggleAuth(showLogin) {
        document.getElementById('login-box').style.display = showLogin ? 'block' : 'none';
        document.getElementById('reg-box').style.display = showLogin ? 'none' : 'block';
    }

    // Логика Входа
    async function handleLogin() {
    const nameInput = document.getElementById('loginInput');
    const isEmpCheck = document.getElementById('isEmployee');
    const isAdminCheck = document.getElementById('isAdmin');
    const errLog = document.getElementById('errorLog');

    if (!nameInput.value) { alert("Введите ФИО"); return; }
    if (errLog) errLog.innerText = "";

    const isEmp = isEmpCheck.checked;
    const isAdmin = isAdminCheck ? isAdminCheck.checked : false;
    const url = isAdmin ? '/login_admin' : (isEmp ? '/login_employee' : '/login');

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ full_name: nameInput.value })
        });
        const data = await res.json();

        if (data.status === 'success') {
            // Собираем объект пользователя правильно
            if (isAdmin) {
                userData = data.employee;
                userData.role = 'admin';
            } else {
                userData = isEmp ? data.employee : data.user;
                userData.role = isEmp ? 'employee' : 'reader';
            }
            
            sessionStorage.setItem('userData', JSON.stringify(userData));
            
            showMainUI(userData);
        } else {
            if (errLog) errLog.innerText = data.message;
            else alert(data.message);
        }
    } catch (e) {
        console.error("Критическая ошибка входа:", e);
    }
}


    // Регистрация нового читателя
    async function handleRegister() {
        const payload = {
            full_name: document.getElementById('regName').value,
            category: document.getElementById('regCat').value,
            institution: document.getElementById('regInst').value,
            organization: document.getElementById('regOrg').value
        };
        if(!payload.full_name) { alert("Введите имя"); return; }

        const res = await fetch('/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Пользователь успешно добавлен в БД! Теперь войдите.");
            toggleAuth(true);
        } else {
            alert("Ошибка регистрации: " + data.message);
        }
    }

    // Переход к основному интерфейсу
function showMainUI(user) {
    // Скрываем вход, показываем интерфейс
    if (document.getElementById('auth-screen')) document.getElementById('auth-screen').style.display = 'none';
    if (document.getElementById('main-ui')) document.getElementById('main-ui').style.display = 'block';

    // Заполняем ФИО в шапке и профиле (проверка на null, чтобы не было ошибки)
    const elTop = document.getElementById('uNameTop');
    const elName = document.getElementById('uName');
    const elOrg = document.getElementById('uOrg');
    const empPanel = document.getElementById('employee-panel');
    const adminPanel = document.getElementById('admin-panel');

    if (elTop) elTop.innerText = user.full_name;
    if (elName) elName.innerText = user.full_name;

    if (user.role === 'admin') {
        if (elOrg) elOrg.innerText = (user.position || "Администратор") + " (Администратор)";
        if (empPanel) empPanel.style.display = 'block';   // админ видит панель сотрудника
        if (adminPanel) adminPanel.style.display = 'block';
        loadStats();
        loadBookings();
        loadAdminTable('readers');
    } else if (user.role === 'employee') {
        if (elOrg) elOrg.innerText = (user.position || "Сотрудник") + " (Сотрудник)";
        if (empPanel) empPanel.style.display = 'block';
        if (adminPanel) adminPanel.style.display = 'none';
        loadStats();
        loadBookings();
    } else {
        if (elOrg) elOrg.innerText = user.attr_institution || user.attr_organization || "Читатель";
        if (empPanel) empPanel.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
    }
}

async function loadAdminTable(type) {
    if (!userData || userData.role !== 'admin') return;

    let url = '/admin/readers';
    if (type === 'employees') url = '/admin/employees';
    if (type === 'logreaders') url = '/admin/logreaders';

    try {
        const res = await fetch(url);
        const data = await res.json();
        const table = document.getElementById('adminTable');
        if (!table) return;

        if (type === 'employees') {
            let html = `<thead><tr><th>ID</th><th>ФИО</th><th>Должность</th><th>Библиотека</th></tr></thead><tbody>`;
            data.forEach(r => {
                html += `<tr><td>${r.id_employee}</td><td>${r.full_name}</td><td>${r.position}</td><td>${r.library}</td></tr>`;
            });
            html += `</tbody>`;
            table.innerHTML = html;
            return;
        }

        if (type === 'logreaders') {
            let html = `<thead><tr><th>ID</th><th>Читатель</th><th>Категория(ID)</th><th>Операция</th></tr></thead><tbody>`;
            data.forEach(r => {
                html += `<tr><td>${r.id}</td><td>${r.reader_name}</td><td>${r.category_id}</td><td>${r.operation}</td></tr>`;
            });
            html += `</tbody>`;
            table.innerHTML = html;
            return;
        }

        // readers
        let html = `<thead><tr><th>ID</th><th>ФИО</th><th>Категория</th><th>Библиотека регистрации</th></tr></thead><tbody>`;
        data.forEach(r => {
            html += `<tr><td>${r.id_reader}</td><td>${r.full_name}</td><td>${r.category}</td><td>${r.reg_library}</td></tr>`;
        });
        html += `</tbody>`;
        table.innerHTML = html;
    } catch (e) {
        console.error("Ошибка загрузки админ-таблицы:", e);
    }
}

    // Загрузка статистики для сотрудников
async function loadStats() {
    try {
        const res = await fetch('/get_stats');
        const data = await res.json();
        
        const totalEl = document.getElementById('statTotal');
        const activeEl = document.getElementById('statActive'); // Проверь, есть ли такой ID в HTML
        
        if (totalEl) totalEl.innerText = data.total;
        if (activeEl) activeEl.innerText = data.active;

        if (data.status_counts) {
            renderStatusChart(data.status_counts);
        }
    } catch (e) {
        console.error("Ошибка загрузки статистики:", e);
    }
}

let statusChartInstance = null;
function renderStatusChart(counts) {
    const ctx = document.getElementById('statusChart');
    if (!ctx) return;

    const available = counts['в наличии'] || 0;
    const issued = counts['выдано'] || 0;
    const booked = counts['забронировано'] || 0;

    const data = {
        labels: ['В наличии', 'Выдано', 'Забронировано'],
        datasets: [{
            data: [available, issued, booked],
            backgroundColor: ['#2ecc71', '#e74c3c', '#f1c40f'],
            borderColor: '#0b1a10',
            borderWidth: 1
        }]
    };

    if (statusChartInstance) {
        statusChartInstance.data = data;
        statusChartInstance.update();
        return;
    }

    statusChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: data,
        options: {
            plugins: {
                legend: {
                    labels: { color: '#ecf0f1' }
                }
            }
        }
    });
}

async function returnIssue(inventoryNumber) {
    if (!confirm(`Принять возврат экземпляра ${inventoryNumber}?`)) return;
    try {
        const res = await fetch('/return_issue', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ inventory_number: inventoryNumber })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Возврат успешно принят.");
            loadStats();
            showStatsTable('active');
        } else {
            alert("Ошибка возврата: " + data.message);
        }
    } catch (e) {
        console.error("Ошибка при возврате:", e);
        alert("Не удалось выполнить возврат.");
    }
}

async function writeoffCopy(inventoryNumber) {
    if (!confirm(`Списать экземпляр ${inventoryNumber}?`)) return;
    try {
        const res = await fetch('/writeoff_copy', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ inventory_number: inventoryNumber })
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Экземпляр успешно списан.");
            showStatsTable('all');
            loadStats();
        } else {
            alert("Ошибка списания: " + data.message);
        }
    } catch (e) {
        console.error("Ошибка при списании:", e);
        alert("Не удалось выполнить списание.");
    }
}

let statsActiveIssuesCache = null;

function applyStatsSearchFilter() {
    const input = document.getElementById('statsSearchInput');
    const q = (input ? input.value : '').toLowerCase().trim();
    if (!statsActiveIssuesCache) return;

    const filtered = !q ? statsActiveIssuesCache : statsActiveIssuesCache.filter(r => {
        const inv = (r.inventory_number || '').toLowerCase();
        const title = (r.title || '').toLowerCase();
        const reader = (r.reader || '').toLowerCase();
        return inv.includes(q) || title.includes(q) || reader.includes(q);
    });

    renderActiveIssuesTable(filtered);
}

function renderActiveIssuesTable(data) {
    let html = `
        <thead>
            <tr>
                <th style="width: 15%">Инв. №</th>
                <th style="width: 35%">Название</th>
                <th style="width: 25%">Читатель</th>
                <th style="width: 10%">Зал</th>
                <th style="width: 15%">Срок возврата</th>
                <th style="width: 10%"></th>
            </tr>
        </thead>
        <tbody>`;

    data.forEach(row => {
        const isOverdue = row.days_overdue && row.days_overdue > 0;
        const dateColor = isOverdue ? '#e74c3c' : '#f1c40f';
        html += `
            <tr>
                <td><code>${row.inventory_number}</code></td>
                <td>${row.title}</td>
                <td>${row.reader}</td>
                <td>${row.hall_number || ''}</td>
                <td style="color: ${dateColor}">${row.due_date}</td>
                <td><button class="btn" style="margin:0; padding:4px 8px;" onclick="returnIssue('${row.inventory_number}')">Принять возврат</button></td>
            </tr>`;
    });

    html += '</tbody>';
    const table = document.getElementById('statsTable');
    if (table) table.innerHTML = html;
}

    async function showStatsTable(type) {
    let url;
    if (type === 'all') url = '/get_all_copies';
    else if (type === 'active') url = '/get_active_issues';
    else if (type === 'writtenoff') url = '/get_writtenoff_copies';
    else url = '/get_all_copies';
    const res = await fetch(url);
    const data = await res.json();

    const searchBox = document.getElementById('statsSearchBox');
    const searchInput = document.getElementById('statsSearchInput');
    if (searchBox) searchBox.style.display = (type === 'active') ? 'block' : 'none';
    if (searchInput) searchInput.value = '';
    
    let html = '';
    if (type === 'all' || type === 'writtenoff') {
        document.getElementById('statsTitle').innerText = (type === 'all') ? "Все экземпляры фонда" : "Списанные экземпляры";
        // Заголовок таблицы
        html = `
            <thead>
                <tr>
                    <th style="width: 15%">Инв. №</th>
                    <th style="width: 50%">Название издания</th>
                    <th style="width: 10%">Зал</th>
                    <th style="width: 15%">Статус</th>
                    <th style="width: 10%"></th>
                </tr>
            </thead>
            <tbody>`;
        
        data.forEach(row => {
            // Красим текст статуса для наглядности
            const statusClass = row.status === 'в наличии' ? 'color: #2ecc71' : (row.status === 'списано' ? 'color:#7f8c8d' : 'color: #e74c3c');
            const writeoffBtn = (type === 'writtenoff' || row.status === 'списано') 
                ? '<span style="color:#7f8c8d">Списано</span>'
                : `<button class="btn" style="margin:0; padding:4px 8px;" onclick="writeoffCopy('${row.inventory_number}')">Списать</button>`;
            html += `
                <tr>
                    <td><code>${row.inventory_number}</code></td>
                    <td><b>${row.title}</b></td>
                    <td>${row.hall_number}</td>
                    <td style="${statusClass}">${row.status}</td>
                    <td>${writeoffBtn}</td>
                </tr>`;
        });
    } else {
        document.getElementById('statsTitle').innerText = "Книги на руках";
        statsActiveIssuesCache = Array.isArray(data) ? data : [];
        renderActiveIssuesTable(statsActiveIssuesCache);
        toggleModal('stats-modal', true);
        return;
    }
    
    html += '</tbody>';
    document.getElementById('statsTable').innerHTML = html;
    toggleModal('stats-modal', true);
}


    // Обновленная функция добавления книги (берет автора)
    async function addNewBook() {
        const payload = {
            title: document.getElementById('newBookTitle').value,
            year: document.getElementById('newBookYear').value,
        author_id: document.getElementById('newBookAuthor').value,
        author_name: document.getElementById('newAuthorName').value,
            pub_type: document.getElementById('newBookType').value
        };
        const res = await fetch('/add_book', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            alert("Издание добавлено и привязано к автору!");
            location.reload();
        }
    }


    // Функции модальных окон
// Функция для переключения модальных окон (проверь, есть ли она у тебя)
function toggleModal(id, show) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

function showBook(title, author, inv, status) {
    selectedInv = inv;
    if(document.getElementById('bTitle')) document.getElementById('bTitle').innerText = title;
    if(document.getElementById('bAuthor')) document.getElementById('bAuthor').innerText = author;
    if(document.getElementById('bInv')) document.getElementById('bInv').innerText = inv;
    if(document.getElementById('bStatus')) document.getElementById('bStatus').innerText = status;
    
    const reserveBtn = document.getElementById('reserveBtn');
    if (reserveBtn) {
        const canReserve = (status.trim().toLowerCase() === 'в наличии' && userData && userData.role === 'reader');
        reserveBtn.style.display = canReserve ? 'block' : 'none';
    }
    toggleModal('book-modal', true);
}


async function makeBooking() {
    // 1. Проверка: а знаем ли мы, кто бронирует?
    if (!userData || !userData.id_reader) {
        alert("Ошибка: Система не видит ваш ID. Попробуйте перезайти в аккаунт.");
        return;
    }
    // 2. Проверка: а выбрали ли мы книгу?
    if (!selectedInv) {
        alert("Ошибка: Инвентарный номер книги не определен.");
        return;
    }

    try {
        const res = await fetch('/create_booking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                inv: selectedInv, 
                user_id: userData.id_reader 
            })
        });
        
        const data = await res.json();
        
        if (data.status === 'success') {
            alert(`Успешно!\nКод брони: ${data.code}\nЗал: ${data.hall}`);
            location.reload();
        } else {
            // Если база вернула ошибку (например, Constraint Violation)
            alert("Ошибка БД: " + data.message);
        }
    } catch (err) {
        // Если сервер упал или URL неверный
        console.error(err);
        alert("Критическая ошибка связи с сервером. Проверьте консоль F12.");
    }
}

// Сборка заказа (Исправлено)
async function processBooking(id) {
    try {
        const res = await fetch('/process_booking', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: id })
        });
        const data = await res.json();
        if (data.status === 'success') {
            console.log("Заказ собран!");
            loadBookings(); // Сразу обновляем список броней на экране
        }
    } catch (e) {
        console.error("Ошибка при сборке заказа:", e);
    }
}

async function loadBookings() {
    const res = await fetch('/get_bookings');
    const data = await res.json();
    const list = document.getElementById('bookingList');
    if (!list) return;

    let html = '';
    data.forEach(b => {
        const btn = b.status === 'новый' ? 
            `<button onclick="processBooking(${b.id_booking})" class="btn" style="width:auto; margin:0; padding:5px 10px;">Собрать</button>` : 
            `<span style="color:#f1c40f">Готов</span>`;
        html += `<div style="border-bottom:1px solid #2ecc71; padding:10px; display:flex; justify-content:space-between; align-items:center;">
                    <span><b>${b.booking_code}</b> | ${b.title}</span> ${btn}
                 </div>`;
    });
    list.innerHTML = html || '<p style="text-align:center">Заказов нет</p>';
}

// Функция загрузки броней для текущего пользователя
    async function loadUserBookings() {
        if (!userData || userData.role !== 'reader') return;
        
        const res = await fetch(`/get_user_bookings/${userData.id_reader}`);
        const data = await res.json();
        let html = '';
        
        data.forEach(b => {
            const color = b.status === 'собран' ? '#2ecc71' : '#f1c40f';
            html += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                <b>${b.booking_code}</b> — ${b.title}<br>
                <small style="color:${color}">Статус: ${b.status}</small>
            </div>`;
        });
        
        document.getElementById('userBookings').innerHTML = html || 'У вас нет активных броней';
    }

    function openProfile() {
        loadUserBookings(); // Обновляем список броней перед показом
        toggleModal('profile-modal', true);
    }

function logout() {
    console.log("Запуск процесса выхода...");
    
    // 0. Очищаем серверную сессию (если есть)
    fetch('/logout', { method: 'POST' }).catch(() => {});

    // 1. Полная очистка хранилища браузера
    sessionStorage.clear();
    localStorage.clear(); // На всякий случай, если данные попали туда
    
    // 2. Обнуляем локальную переменную в скрипте
    userData = null;
    
    // 3. Скрываем все элементы интерфейса вручную (до перезагрузки)
    if (document.getElementById('main-ui')) document.getElementById('main-ui').style.display = 'none';
    if (document.getElementById('employee-panel')) document.getElementById('employee-panel').style.display = 'none';
    
    // 4. Показываем окно входа
    if (document.getElementById('auth-screen')) document.getElementById('auth-screen').style.display = 'flex';
    
    // 5. Перенаправляем на главную страницу (это надежнее reload)
    window.location.href = "/";
}

async function loadReaderProfileData() {
    if (!userData || userData.role !== 'reader') return;

    try {
        const res = await fetch(`/get_reader_info/${userData.id_reader}`);
        const data = await res.json();

        // 1. Отрисовка Бронирований
        let bHtml = '';
        data.bookings.forEach(b => {
            const statusColor = b.status === 'собран' ? '#2ecc71' : '#f1c40f';
            bHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                <b style="color:#2ecc71">${b.booking_code}</b> — ${b.title} <br>
                <small>Статус: <span style="color:${statusColor}">${b.status}</span></small>
            </div>`;
        });
        document.getElementById('userActiveBookings').innerHTML = bHtml || 'У вас нет активных броней';

        // 2. Отрисовка Выданных книг
        let iHtml = '';
        let totalFine = 0;
        data.issues.forEach(i => {
            const isOverdue = i.days_overdue && i.days_overdue > 0;
            if (isOverdue) {
                totalFine += i.days_overdue * 10;
            }
            iHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                <b>${i.title}</b> <br>
                <small>Вернуть до: <span style="color:${isOverdue ? '#e74c3c' : '#f1c40f'}">${i.due_date}</span> (Инв: ${i.inventory_number})</small>
            </div>`;
        });
        document.getElementById('userActiveIssues').innerHTML = iHtml || 'У вас нет книг на руках';

        // 3. История чтений
        let hHtml = '';
        data.history.forEach(h => {
            hHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                <b>${h.title}</b><br>
                <small>Выдана: ${h.issue_date} — Возвращена: ${h.return_date} (Инв: ${h.inventory_number})</small>
            </div>`;
        });
        const histBox = document.getElementById('userHistoryIssues');
        if (histBox) histBox.innerHTML = hHtml || 'История пока пуста';

        // 4. Штраф
        const fineBox = document.getElementById('uFine');
        if (fineBox) fineBox.innerText = totalFine.toString();

    } catch (e) {
        console.error("Ошибка загрузки профиля:", e);
    }
}

async function openProfileModal() {
    // 1. Показываем саму модалку
    toggleModal('profile-modal', true);

    // 2. Если вошел ЧИТАТЕЛЬ — идем за данными
    if (userData && userData.role === 'reader') {
        try {
            // Тот самый запрос "7" со скриншота
            const res = await fetch(`/get_reader_info/${userData.id_reader}`);
            const data = await res.json();
            
            console.log("ДАННЫЕ ПРИШЛИ:", data); // ПРОВЕРЬ ЭТО В КОНСОЛИ

            const bBox = document.getElementById('userActiveBookings');
            const iBox = document.getElementById('userActiveIssues');

            // Отрисовка броней
            if (bBox) {
                let bHtml = '';
                data.bookings.forEach(b => {
                    bHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                        <b style="color:#2ecc71">${b.booking_code}</b> — ${b.title} <br>
                        <small>Статус: ${b.status}</small>
                    </div>`;
                });
                bBox.innerHTML = bHtml || 'Нет активных броней';
            }

            // Отрисовка выданных книг + штраф
            if (iBox) {
                let iHtml = '';
                let totalFine = 0;
                data.issues.forEach(i => {
                    const isOverdue = i.days_overdue && i.days_overdue > 0;
                    if (isOverdue) totalFine += i.days_overdue * 10;
                    iHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                        <b>${i.title}</b> <br>
                        <small style="color:${isOverdue ? '#e74c3c' : '#f1c40f'}">Вернуть до: ${i.due_date}</small>
                    </div>`;
                });
                iBox.innerHTML = iHtml || 'Нет книг на руках';

                const fineBox = document.getElementById('uFine');
                if (fineBox) fineBox.innerText = totalFine.toString();
            }

            // История чтений
            const hBox = document.getElementById('userHistoryIssues');
            if (hBox && data.history) {
                let hHtml = '';
                data.history.forEach(h => {
                    hHtml += `<div style="margin-bottom:8px; border-bottom:1px solid #1a3a2a; padding-bottom:5px;">
                        <b>${h.title}</b><br>
                        <small>Выдана: ${h.issue_date} — Возвращена: ${h.return_date} (Инв: ${h.inventory_number})</small>
                    </div>`;
                });
                hBox.innerHTML = hHtml || 'История пока пуста';
            }
        } catch (e) {
            console.error("Ошибка отрисовки профиля:", e);
        }
    }
    
    // Заполняем ФИО и статус (всегда)
    if(document.getElementById('uName')) document.getElementById('uName').innerText = userData.full_name;
    if(document.getElementById('uOrg')) {
        document.getElementById('uOrg').innerText = userData.role === 'employee' ? 
            "Сотрудник библиотеки" : (userData.attr_institution || "Читатель");
    }
}

async function issueByCode() {
    const codeInput = document.getElementById('issueCode');
    if (!codeInput || !codeInput.value) {
        alert("Введите код бронирования!");
        return;
    }

    try {
        const res = await fetch('/issue_by_code', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                code: codeInput.value, 
                emp_id: userData.id_employee 
            })
        });
        const data = await res.json();

        if (data.status === 'success') {
            alert("Книга успешно выдана читателю!");
            codeInput.value = ''; // Очищаем поле
            loadStats();    // Обновляем счетчики
            loadBookings(); // Обновляем список броней
        } else {
            alert("Ошибка: " + data.message);
        }
    } catch (e) {
        console.error("Ошибка при выдаче:", e);
        alert("Произошла ошибка при связи с сервером.");
    }
}

// Живой поиск и фильтры каталога
let currentCategoryFilter = 'all';

function setCategoryFilter(cat) {
    currentCategoryFilter = cat;
    applyCatalogFilters();
}

function applyCatalogFilters() {
    const input = document.getElementById('searchInput');
    const query = (input ? input.value : '').toLowerCase();

    const cards = document.querySelectorAll('.book-card');
    cards.forEach(card => {
        const title = (card.dataset.title || '').toLowerCase();
        const type = card.dataset.type || 'Книга';

        const matchesText = !query || title.includes(query);
        const matchesCat = currentCategoryFilter === 'all' || type === currentCategoryFilter;

        card.style.display = (matchesText && matchesCat) ? 'block' : 'none';
    });
}

function downloadReport(type) {
    window.open(`/report/${type}`, '_blank');
}

function downloadExcelReport(type) {
    window.open(`/export_report?type=${type}`, '_blank');
}
