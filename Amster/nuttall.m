function w=nuttall(n,ver)
% use with odd number to get symmetric filter around unity
%https://www.mathworks.com/help/signal/ref/nuttallwin.html
% half power point is near 0.3764
if nargin<2, ver=1; end
w=zeros(n,1);
if floor(n/2)==n/2 %if n is even
    iout=2:n;
    n=n-1;
else
    iout=1:n;
end
arg=2*pi*(0:n-1)/(n-1);
switch ver
    case 1
        a=[0.3635819 0.4891775 0.1365995 0.0106411];
    case 2 % correction for endpoint offset
        %a=[0.3635819-0.0003628 0.4891775 0.1365995 0.0106411];
        % sum(a)=0.9996372, divided by 0.9996372=
        a=[0.3633509      0.489355     0.1366491    0.01064496];
    case 3 %https://www.recordingblogs.com/wiki/nuttall-window
        a=[0.355768 0.487396 0.144232 -0.012604];
end
w(iout)=a(1)-a(2)*cos(arg)+a(3)*cos(2*arg)-a(4) *cos(3*arg);