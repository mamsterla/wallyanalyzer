function hit=find(c)
% $$$  hit: are non-empty entries in 
% $$$ c: cell array
% $$$ c = {    []    []    [6]    []    []    []    []};
% $$$ 
% $$$ c{hit}

  hit=find(~cellfun('isempty',c));
