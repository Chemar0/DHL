// File purpose: Landing-page interaction hooks; currently a lightweight entry point reserved for landing-specific behavior.

document.getElementById('mechanical-button').addEventListener('click', () => {
    window.location.href = 'mechanical.html';
});

document.getElementById('electrical-button').addEventListener('click', () => {
    window.location.href = 'electrical.html';
});
