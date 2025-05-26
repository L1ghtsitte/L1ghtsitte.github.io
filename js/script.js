document.addEventListener('DOMContentLoaded', function() {
    // Элементы звуков
    const hoverElements = document.querySelectorAll('.interest-card, .social-link, .music-btn');
    const clickSound = document.getElementById('clickSound');
    const bgMusic = document.getElementById('bgMusic');
    const musicToggle = document.getElementById('musicToggle');
    
    // Пентаграмма
    const pentagram = document.querySelector('.pentagram');
    
    // Карусель цитат
    const quotes = document.querySelectorAll('.quote');
    let currentQuote = 0;
    
    // Инициализация
    initHoverEffects();
    initClickEffects();
    initBloodDrops();
    startQuoteCarousel();
    
    // Фоновый звук
    let isMusicPlaying = false;
    musicToggle.addEventListener('click', function() {
        if (isMusicPlaying) {
            bgMusic.pause();
            musicToggle.textContent = '🔊 Включить ритуал';
        } else {
            bgMusic.play();
            musicToggle.textContent = '🔇 Выключить ритуал';
        }
        isMusicPlaying = !isMusicPlaying;
        playClickSound();
    });
    
    // Эффекты при наведении
    function initHoverEffects() {
        const hoverElements = document.querySelectorAll('.interest-card, .social-link, .music-btn');
        
        hoverElements.forEach(el => {
            el.addEventListener('mouseenter', function() {
                playHoverSound();
                
                // Случайное изменение размера пентаграммы
                const randomScale = 0.9 + Math.random() * 0.2;
                pentagram.style.transform = `translate(-50%, -50%) scale(${randomScale})`;
                
                // Эффект пульсации для карточек
                if (el.classList.contains('interest-card')) {
                    el.style.boxShadow = `0 0 ${10 + Math.random() * 10}px var(--blood-red)`;
                }
            });
            
            el.addEventListener('mouseleave', function() {
                // Возвращаем пентаграмму к исходному размеру
                pentagram.style.transform = 'translate(-50%, -50%) scale(1)';
                
                if (el.classList.contains('interest-card')) {
                    el.style.boxShadow = '';
                }
            });
        });
    }
    
    // Эффекты при клике
    function initClickEffects() {
        const clickElements = document.querySelectorAll('.interest-card, .social-link, .music-btn, .profile-image');
        
        clickElements.forEach(el => {
            el.addEventListener('click', function() {
                playClickSound();
                
                // Создаем эффект крови при клике
                if (el.classList.contains('profile-image')) {
                    createBloodSplatter(el);
                }
                
                // Случайное вращение элемента
                if (Math.random() > 0.7) {
                    const randomRotate = -5 + Math.random() * 10;
                    el.style.transform = `rotate(${randomRotate}deg)`;
                    setTimeout(() => {
                        el.style.transform = '';
                    }, 300);
                }
            });
        });
    }
    
    // Анимированные капли крови
    function initBloodDrops() {
        const bloodDrops = document.querySelectorAll('.blood-drop');
        
        bloodDrops.forEach(drop => {
            // Случайная анимация
            const duration = 3 + Math.random() * 4;
            const delay = Math.random() * 5;
            
            drop.style.animation = `bloodPulse ${duration}s infinite ${delay}s`;
            
            // Случайное мерцание
            setInterval(() => {
                if (Math.random() > 0.7) {
                    drop.style.opacity = 0.3 + Math.random() * 0.5;
                }
            }, 1000);
        });
    }
    
    // Карусель цитат
    function startQuoteCarousel() {
        setInterval(() => {
            quotes[currentQuote].classList.remove('active');
            currentQuote = (currentQuote + 1) % quotes.length;
            quotes[currentQuote].classList.add('active');
        }, 7000);
    }
    
    // Эффект брызг крови
    function createBloodSplatter(element) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        for (let i = 0; i < 10; i++) {
            const splatter = document.createElement('div');
            splatter.className = 'blood-splatter';
            
            // Случайные параметры
            const size = 5 + Math.random() * 15;
            const angle = Math.random() * Math.PI * 2;
            const distance = 10 + Math.random() * 50;
            const duration = 0.5 + Math.random() * 1;
            
            const x = centerX + Math.cos(angle) * distance;
            const y = centerY + Math.sin(angle) * distance;
            
            splatter.style.width = `${size}px`;
            splatter.style.height = `${size}px`;
            splatter.style.left = `${x}px`;
            splatter.style.top = `${y}px`;
            splatter.style.backgroundColor = `rgba(138, 3, 3, ${0.3 + Math.random() * 0.7})`;
            splatter.style.borderRadius = `${Math.random() * 50}%`;
            splatter.style.position = 'fixed';
            splatter.style.pointerEvents = 'none';
            splatter.style.zIndex = '1000';
            splatter.style.animation = `fadeOut ${duration}s forwards`;
            
            document.body.appendChild(splatter);
            
            // Удаляем через время
            setTimeout(() => {
                splatter.remove();
            }, duration * 1000);
        }
    }
    
    // Звуковые эффекты
    function playHoverSound() {
        hoverSound.currentTime = 0;
        hoverSound.volume = 0.3;
        hoverSound.play();
    }
    
    function playClickSound() {
        clickSound.currentTime = 0;
        clickSound.volume = 0.4;
        clickSound.play();
    }
    
    // Добавляем стили для анимации fadeOut
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeOut {
            to {
                opacity: 0;
                transform: scale(1.5);
            }
        }
    `;
    document.head.appendChild(style);
    
    // Случайное мерцание заголовка
    setInterval(() => {
        if (Math.random() > 0.8) {
            const title = document.querySelector('.title');
            title.style.textShadow = `0 0 ${5 + Math.random() * 15}px var(--blood-red)`;
            setTimeout(() => {
                title.style.textShadow = '';
            }, 100);
        }
    }, 300);
});