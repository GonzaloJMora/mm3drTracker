function switchMobileTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tracker-section').forEach(sec => sec.classList.remove('active-section'))

    if (tabName === 'items') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('item-section').classList.add('active-section');
    }
    else {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('location-section').classList.add('active-section');
    }
}
