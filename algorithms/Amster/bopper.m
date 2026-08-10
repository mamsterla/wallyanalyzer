function bopper(str)
  if nargin<1, str='warn'; end
  Fs=2^13; %sample frequency, Hz
  dt=1/Fs;
  T=0.1; %beep duration, s
  t=(0:dt:T);
  hi=sin(2*pi*440*sqrt(2)*t)/2;
  med=sin(2*pi*440*t);
  low=sin(2*pi*440/sqrt(2)*t)*2;
  if length(regexp(str,'warn')),
    for ii=1:3, sound(med,Fs); pause(.1); end, sound(hi,Fs);
  elseif length(regexp(str,'err')),
    for ii=1:3, sound(med,Fs); pause(.1); end, sound(low,Fs);
  elseif length(regexp(str,'prompt')),
    sound(med,Fs); pause(.1); sound(hi,Fs);
  else
    disp('bopper.m got a wrong argument')
    beep
  end
    