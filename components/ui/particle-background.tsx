"use client";

import React, { useEffect, useRef } from 'react';

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];
    
    // Config
    const PARTICLE_COUNT = 150;
    const MAX_CONNECTION_DISTANCE = 120;
    const MOUSE_RADIUS = 180;
    
    const mouse = {
      x: -1000,
      y: -1000,
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };

    const handleMouseLeave = () => {
      mouse.x = -1000;
      mouse.y = -1000;
    };

type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      baseX: number;
      baseY: number;
    };

    const createParticle = (): Particle => ({
      x: Math.random() * (canvas?.width ?? window.innerWidth),
      y: Math.random() * (canvas?.height ?? window.innerHeight),
      baseX: 0,
      baseY: 0,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 1.5 + 0.5,
    });

    const updateParticle = (p: Particle) => {
      if (!canvas) return;
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < MOUSE_RADIUS) {
        const forceDirectionX = dx / distance;
        const forceDirectionY = dy / distance;
        const force = (MOUSE_RADIUS - distance) / MOUSE_RADIUS;

        const maxSpeed = 3;
        p.x -= forceDirectionX * force * maxSpeed;
        p.y -= forceDirectionY * force * maxSpeed;
      }
    };

    const drawParticle = (p: Particle) => {
      if (!ctx) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      const isDark = document.documentElement.classList.contains('dark');
      ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.8)';
      ctx.fill();
    };

    const init = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(createParticle());
      }
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const isDark = document.documentElement.classList.contains('dark');
      const lineColor = isDark ? '255, 255, 255' : '0, 0, 0';

      for (let i = 0; i < particles.length; i++) {
        updateParticle(particles[i]);
        drawParticle(particles[i]);

        // Connect nearby particles
        for (let j = i; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < MAX_CONNECTION_DISTANCE) {
            const opacity = 1 - (distance / MAX_CONNECTION_DISTANCE);
            ctx.beginPath();
            // Optional: only connect to mouse nearby
            const mouseDx = mouse.x - particles[i].x;
            const mouseDy = mouse.y - particles[i].y;
            const mouseDist = Math.sqrt(mouseDx * mouseDx + mouseDy * mouseDy);
            
            if (mouseDist < MOUSE_RADIUS * 1.5) {
               const strokeOpacity = opacity * (isDark ? 0.3 : 0.6);
               ctx.strokeStyle = `rgba(${lineColor}, ${strokeOpacity})`;
               ctx.lineWidth = 0.6;
               ctx.moveTo(particles[i].x, particles[i].y);
               ctx.lineTo(particles[j].x, particles[j].y);
               ctx.stroke();
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(animate);
    };

    window.addEventListener('resize', init);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    
    init();
    animate();

    return () => {
      window.removeEventListener('resize', init);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none w-full h-[100vh]"
    />
  );
}
