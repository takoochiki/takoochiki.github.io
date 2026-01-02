function toggleVideo(header) {
    const card = header.parentElement;
    const table = card.querySelector('.comments-table');
    const icon = header.querySelector('.toggle-icon');
    
    if (table.classList.contains('collapsed')) {
        table.classList.remove('collapsed');
        if(icon) icon.classList.remove('collapsed-icon');
    } else {
        table.classList.add('collapsed');
        if(icon) icon.classList.add('collapsed-icon');
    }
}
